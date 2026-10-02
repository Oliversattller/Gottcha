const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const ROOT = path.join(__dirname, 'public');
const MAX_FRAME = 64 * 1024;
const rooms = new Map();
const peers = new Set();

function sendFrame(socket, data, opcode = 1) {
  if (socket.destroyed) return;
  const payload = Buffer.from(data);
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x80 | opcode, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  socket.write(Buffer.concat([header, payload]));
}
function send(peer, body) { sendFrame(peer.socket, JSON.stringify(body)); }
function safeName(value) { return String(value || '').trim().slice(0, 20); }
function cleanCoord(n, min, max) { n = Number(n); return Number.isFinite(n) && n >= min && n <= max ? n : null; }
function validPoint(point) {
  if (!point) return null;
  const lat = cleanCoord(point.lat, -90, 90), lng = cleanCoord(point.lng, -180, 180);
  return lat === null || lng === null ? null : { lat, lng, accuracy: Math.max(0, Math.min(1000, Number(point.accuracy) || 0)) };
}
function meters(a, b) {
  const rad = n => n * Math.PI / 180, R = 6371000;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
function currentZoneRadius(room, now = Date.now()) {
  const { zoneRadius, mode, duration, finalZone } = room.settings;
  if (mode !== 'shrink' || !room.startedAt) return zoneRadius;
  const fraction = Math.min(1, Math.max(0, (now - room.startedAt) / (duration * 60 * 1000)));
  const steps = Math.floor(fraction * duration / 5);
  const endRatio = finalZone === 'small' ? 0.18 : finalZone === 'large' ? 0.48 : 0.32;
  const intervals = Math.max(1, Math.ceil(duration / 5));
  return Math.max(80, zoneRadius * (1 - (1 - endRatio) * Math.min(1, steps / intervals)));
}
function publicState(room) {
  const now = Date.now();
  return {
    type: 'state', code: room.code, hostId: room.hostId,
    settings: room.settings, center: room.center, startedAt: room.startedAt,
    zoneRadius: currentZoneRadius(room, now), ended: !!room.ended,
    revealUntil: room.revealUntil || null, nextPingAt: room.nextPingAt || null,
    players: [...room.players.values()].map(p => {
      const viewer = room.players.get(room.viewerId);
      const visible = viewer && (viewer.id === p.id || (viewer.role === 'Sucher' && p.role === 'Versteckter' && room.revealUntil && room.revealUntil > now));
      const closeForManualTag = viewer && viewer.role === 'Sucher' && p.role === 'Versteckter' && !p.caught && viewer.point && p.point
        ? meters(viewer.point, p.point) <= room.settings.catchDistance : false;
      return { id: p.id, name: p.name, icon: p.icon, role: p.role, point: visible ? p.point : null, caught: p.caught, caughtReason: p.caughtReason, online: p.online, ready: p.ready, withinCatchDistance: closeForManualTag, outsideSince: p.outsideSince || null };
    })
  };
}
function broadcast(room) {
  for (const peer of peers) if (peer.roomCode === room.code) { room.viewerId = peer.playerId; send(peer, publicState(room)); }
  room.viewerId = null;
}
function replyError(peer, message) { send(peer, { type: 'error', message }); }
function addPlayer(peer, room, name, point, role) {
  const id = crypto.randomUUID();
  const player = { id, name: safeName(name), icon: String(peer.icon || '🦊').slice(0, 8), role, point, online: true, ready: false, caught: false, caughtReason: null, outsideSince: null };
  room.players.set(id, player); peer.roomCode = room.code; peer.playerId = id; peer.icon = player.icon;
  send(peer, { type: 'joined', playerId: id, code: room.code });
  return player;
}
function closeConnection(peer) {
  if (peer.closed) return;
  peer.closed = true; peers.delete(peer);
  const room = rooms.get(peer.roomCode), player = room && room.players.get(peer.playerId);
  if (player) { player.online = false; broadcast(room); }
}
function tryAutoCatch(room, changedPlayer) {
  if (!room.startedAt || room.ended || room.settings.catchMode !== 'auto' || changedPlayer.caught || !changedPlayer.point) return;
  const hiders = changedPlayer.role === 'Versteckter' ? [changedPlayer] : [...room.players.values()].filter(p => p.role === 'Versteckter' && !p.caught);
  for (const hider of hiders) for (const seeker of room.players.values()) {
    if (seeker.role === 'Sucher' && !seeker.caught && seeker.online && seeker.point && meters(hider.point, seeker.point) <= room.settings.catchDistance) {
      hider.caught = true; hider.caughtReason = 'gefunden'; hider.caughtBy = seeker.name; break;
    }
  }
}
function updatePresence(room, player) {
  if (!room.startedAt || player.caught || player.role !== 'Versteckter' || !player.point) return;
  const outside = meters(room.center, player.point) > currentZoneRadius(room);
  if (!outside) { player.outsideSince = null; return; }
  if (!player.outsideSince) { player.outsideSince = Date.now(); return; }
  if (Date.now() - player.outsideSince > 15000) { player.caught = true; player.caughtReason = 'außerhalb der Zone'; }
}
function handle(peer, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return replyError(peer, 'Ungültige Nachricht.'); }
  if (!msg || typeof msg.type !== 'string') return replyError(peer, 'Ungültige Aktion.');
  if (msg.type === 'create') {
    if (peer.roomCode) return replyError(peer, 'Du bist bereits in einer Runde.');
    const name = safeName(msg.name), point = validPoint(msg.point);
    if (!name || !point) return replyError(peer, 'Name und Standortfreigabe sind erforderlich.');
    const s = msg.settings || {};
    let code; do { code = String(crypto.randomInt(100000, 1000000)); } while (rooms.has(code));
    const room = { code, hostId: null, center: { lat: point.lat, lng: point.lng }, startedAt: null, createdAt: Date.now(), settings: {
      duration: Math.max(10, Math.min(60, Number(s.duration) || 30)),
      mode: s.mode === 'normal' ? 'normal' : 'shrink',
      zoneRadius: Math.max(100, Math.min(5000, Number(s.zoneRadius) || 800)),
      finalZone: ['small','medium','large'].includes(s.finalZone) ? s.finalZone : 'medium',
      pingInterval: Math.max(1, Math.min(10, Number(s.pingInterval) || 3)),
      catchMode: s.catchMode === 'manual' ? 'manual' : 'auto',
      catchDistance: Math.max(2, Math.min(100, Number(s.catchDistance) || 20))
    }, players: new Map() };
    room.hostId = peer.playerId = crypto.randomUUID();
    rooms.set(code, room);
    const player = { id: peer.playerId, name, icon: String(msg.icon || '🦊').slice(0,8), role: 'Sucher', point, online: true, ready: true, caught: false, caughtReason: null, outsideSince: null };
    peer.roomCode = code; peer.icon = player.icon; room.players.set(player.id, player);
    send(peer, { type: 'joined', playerId: player.id, code }); broadcast(room); return;
  }
  if (msg.type === 'join') {
    const room = rooms.get(String(msg.code || '').replace(/\D/g, '').slice(0, 6));
    const name = safeName(msg.name), point = validPoint(msg.point);
    if (!room) return replyError(peer, 'Spielcode nicht gefunden.');
    if (room.startedAt) return replyError(peer, 'Diese Runde läuft bereits.');
    if (!name || !point) return replyError(peer, 'Name und Standortfreigabe sind erforderlich.');
    if (room.players.size >= 20) return replyError(peer, 'Die Lobby ist voll (maximal 20 Spieler).');
    addPlayer(peer, room, name, point, 'Versteckter'); broadcast(room); return;
  }
  const room = rooms.get(peer.roomCode), player = room && room.players.get(peer.playerId);
  if (!room || !player) return replyError(peer, 'Tritt zuerst einer Runde bei.');
  if (room.startedAt && !room.ended && Date.now() >= room.startedAt + room.settings.duration * 60 * 1000) { room.ended = true; broadcast(room); }
  if (msg.type === 'location') {
    const point = validPoint(msg.point); if (!point) return;
    player.point = point; player.online = true; player.lastLocation = Date.now();
    if (room.startedAt) { tryAutoCatch(room, player); updatePresence(room, player); }
    broadcast(room); return;
  }
  if (msg.type === 'role') {
    if (room.startedAt) return replyError(peer, 'Rollen können nach dem Start nicht geändert werden.');
    const next = msg.role === 'Sucher' ? 'Sucher' : 'Versteckter';
    if (next === 'Sucher' && [...room.players.values()].filter(p => p.role === 'Sucher').length >= 2) return replyError(peer, 'Maximal zwei Sucher sind erlaubt.');
    player.role = next; broadcast(room); return;
  }
  if (msg.type === 'ready') { player.ready = !!msg.ready; broadcast(room); return; }
  if (msg.type === 'start') {
    if (player.id !== room.hostId) return replyError(peer, 'Nur der Ersteller kann starten.');
    const list = [...room.players.values()];
    if (list.length < 2 || !list.some(p => p.role === 'Sucher') || !list.some(p => p.role === 'Versteckter')) return replyError(peer, 'Mindestens ein Sucher und ein Versteckter nötig.');
    room.startedAt = Date.now(); room.revealUntil = room.startedAt + 8000; room.nextPingAt = room.startedAt + room.settings.pingInterval * 60 * 1000; broadcast(room); return;
  }
  if (msg.type === 'tag') {
    if (!room.startedAt || room.ended || player.role !== 'Sucher') return replyError(peer, 'Nur Sucher können während einer laufenden Runde fangen.');
    if (room.settings.catchMode !== 'manual') return replyError(peer, 'In dieser Runde ist automatisches Fangen eingestellt.');
    const target = room.players.get(String(msg.targetId || ''));
    if (!target || target.role !== 'Versteckter' || target.caught) return replyError(peer, 'Dieser Spieler ist nicht mehr im Spiel.');
    if (!player.point || !target.point) return replyError(peer, 'Standorte sind noch nicht verfügbar.');
    const distance = meters(player.point, target.point);
    if (distance > room.settings.catchDistance) return replyError(peer, `Zu weit weg: ${Math.round(distance)} m (Fangabstand ${room.settings.catchDistance} m).`);
    target.caught = true; target.caughtReason = 'manuell gefangen'; target.caughtBy = player.name; broadcast(room); return;
  }
  if (msg.type === 'ping') { send(peer, { type: 'pong' }); return; }
  if (msg.type === 'leave') { closeConnection(peer); try { peer.socket.close(); } catch {} }
}

function staticFile(req, res) {
  if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, rooms: rooms.size })); }
  const pathname = decodeURIComponent((req.url || '/').split('?')[0]);
  const target = path.resolve(ROOT, pathname === '/' ? 'index.html' : '.' + pathname);
  if (!target.startsWith(ROOT + path.sep) && target !== path.join(ROOT, 'index.html')) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(target, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(target);
    const type = ext === '.html' ? 'text/html; charset=utf-8' : ext === '.js' ? 'text/javascript; charset=utf-8' : ext === '.css' ? 'text/css; charset=utf-8' : ext === '.webmanifest' ? 'application/manifest+json; charset=utf-8' : ext === '.svg' ? 'image/svg+xml' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' }); res.end(data);
  });
}
const server = http.createServer(staticFile);
server.on('upgrade', (req, socket) => {
  if (req.url !== '/ws' || !req.headers['sec-websocket-key']) { socket.destroy(); return; }
  const expectedOrigin = process.env.APP_ORIGIN || process.env.RENDER_EXTERNAL_URL;
  if ((process.env.NODE_ENV === 'production' && (!expectedOrigin || req.headers.origin !== expectedOrigin)) || (expectedOrigin && req.headers.origin !== expectedOrigin)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const peer = { socket, roomCode: null, playerId: null, buffer: Buffer.alloc(0), closed: false }; peers.add(peer);
  socket.on('data', chunk => {
    peer.buffer = Buffer.concat([peer.buffer, chunk]);
    while (peer.buffer.length >= 2) {
      const b0 = peer.buffer[0], b1 = peer.buffer[1], opcode = b0 & 15, masked = !!(b1 & 128); let len = b1 & 127, offset = 2;
      if (len === 126) { if (peer.buffer.length < 4) return; len = peer.buffer.readUInt16BE(2); offset = 4; }
      else if (len === 127) { if (peer.buffer.length < 10) return; const big = peer.buffer.readBigUInt64BE(2); if (big > BigInt(MAX_FRAME)) return socket.destroy(); len = Number(big); offset = 10; }
      if (len > MAX_FRAME) return socket.destroy();
      const maskBytes = masked ? 4 : 0; if (peer.buffer.length < offset + maskBytes + len) return;
      let payload = peer.buffer.subarray(offset + maskBytes, offset + maskBytes + len);
      if (masked) { payload = Buffer.from(payload); const mask = peer.buffer.subarray(offset, offset + 4); for (let i=0;i<payload.length;i++) payload[i] ^= mask[i % 4]; }
      peer.buffer = peer.buffer.subarray(offset + maskBytes + len);
      if (opcode === 8) { sendFrame(socket, Buffer.alloc(0), 8); socket.end(); closeConnection(peer); return; }
      if (opcode === 9) { sendFrame(socket, payload, 10); continue; }
      if (opcode !== 1) continue;
      handle(peer, payload.toString('utf8'));
    }
  });
  socket.on('close', () => closeConnection(peer)); socket.on('error', () => closeConnection(peer));
});
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.startedAt && !room.ended && now >= room.startedAt + room.settings.duration * 60 * 1000) { room.ended = true; broadcast(room); }
    if (room.startedAt && !room.ended && room.nextPingAt && now >= room.nextPingAt) { room.revealUntil = now + 8000; room.nextPingAt = now + room.settings.pingInterval * 60 * 1000; broadcast(room); }
    if (Date.now() - room.createdAt > 3 * 60 * 60 * 1000 && ![...peers].some(p => p.roomCode === code)) rooms.delete(code);
  }
}, 1000).unref();
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => console.log(`Gotcha Live listening on ${HOST}:${PORT}`));
