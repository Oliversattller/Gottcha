# Gotcha Live

Ein spielbarer Mehrspieler-Prototyp für GPS-Verstecken. Frontend und Echtzeit-Server laufen im selben Node-Prozess; es werden keine npm-Pakete benötigt.

## Lokal starten

Voraussetzung: Node.js 22 oder neuer.

```sh
npm install
npm start
```

Öffne anschließend `http://localhost:3000`. GPS ist auf `localhost` für Entwicklung erlaubt. Für andere Geräte oder Freunde braucht die App eine öffentlich erreichbare HTTPS-Adresse; dadurch verwendet sie automatisch WebSockets über `wss://`. Die Web-Version sendet im Vordergrund. Für Standortfreigabe im Hintergrund muss die native iPhone-App installiert sein.

## iPhone-App

Capacitor verpackt die Web-Oberfläche als iPhone-App. Die native Hintergrund-Ortung nutzt `@capgo/background-geolocation`; sie sendet Koordinaten direkt per HTTPS an den Server, auch wenn die WebView pausiert. In der App gibt es eine Schaltfläche zum Stoppen.

```sh
npm install
npm run cap:sync
npm run cap:ios
```

In `ios/App/App/Info.plist` sind die Begründungen für Standortzugriff im Vordergrund und Hintergrund sowie der Background Mode `location` bereits eingetragen. Öffne das Projekt auf einem Mac mit `npx cap open ios`, teste die Freigabe auf einem echten iPhone und erstelle dort den Installationsbuild. Für die Verteilung und TestFlight brauchst du Xcode auf macOS und Apples Entwicklerkonto.

Das Betriebssystem kann die Erfassung begrenzen: iOS stoppt Standortupdates, wenn die Person die App ausdrücklich beendet. Es wird nur so lange gesendet, wie die Einwilligung aktiv ist und der Standortzugriff erlaubt bleibt.

## So funktioniert eine Runde

1. Der Ersteller erlaubt seinen Standort, wählt Regeln und erstellt einen Raum.
2. Freunde erlauben ebenfalls Standort und treten mit dem sechsstelligen Code bei.
3. In der Lobby kann jeder die Rolle wechseln. Der Ersteller startet, sobald mindestens ein Sucher und ein Versteckter dabei sind.
4. Die Karte zeigt die echte Spielzone als Kreis um den GPS-Standort des Erstellers. Radius und Shrink-Endgröße sind einstellbar.
5. Suchende sehen die Standorte der Versteckten nur kurz während der regelmäßigen Standort-Pings. Eigene Positionen bleiben sichtbar; Versteckte sehen die Positionen der Suchenden nicht.
6. Automatisches Fangen passiert serverseitig innerhalb des eingestellten Abstands. Im manuellen Modus meldet der Sucher den Fang per Knopfdruck; der Server prüft ebenfalls den Abstand.

## Online hosten

Der Host muss Node.js unterstützen, WebSocket-Upgrades durchlassen und HTTPS/WSS bereitstellen. `render.yaml` enthält eine Render-Konfiguration für einen kostenlosen Start; nach dem Verbinden eines GitHub-Repositories kann Render die Datei als Blueprint einlesen. Render setzt `RENDER_EXTERNAL_URL`, das der Server für den WebSocket-Origin-Check verwendet. Stelle für einen ersten Server genau **eine laufende Instanz** ein: Spielräume und aktuelle Standorte liegen absichtlich nur im Arbeitsspeicher des Prozesses. Ein Neustart beendet alle aktiven Runden. Ein Host mit mehreren parallelen Instanzen braucht eine gemeinsame Echtzeit-Datenbank oder einen Durable-Object/WebSocket-Dienst.

Setze in Produktion:

```text
NODE_ENV=production
PORT=<vom Host vorgegeben>
HOST=0.0.0.0
APP_ORIGIN=https://<genaue-app-domain>
```

`APP_ORIGIN` muss exakt der Website-Origin entsprechen, zum Beispiel `https://spiel.example`; der Server weist WebSocket-Verbindungen von anderen Origins zurück. Bewahre den Wert als Server-Umgebungsvariable auf, nicht im Browsercode.

`Dockerfile` ist als Container-Einstieg vorhanden. Plattformen, die nur statische Dateien oder serverlose Kurzaufrufe hosten, reichen für den Echtzeit-Server nicht aus.

## Kartenmaterial

Die Karte nutzt Leaflet und sichtbare OpenStreetMap-Kacheln mit Quellenangabe. Die öffentlichen OSM-Kachelserver werden gemeinschaftlich finanziert und haben keine Verfügbarkeitsgarantie. Für viele Spieler oder einen öffentlichen Produktivbetrieb sollte ein geeigneter Kartenanbieter eingerichtet werden; Leaflet erlaubt den Wechsel des Kachelproviders.

## Datenschutz und Grenzen

- Das Backend speichert Namen, Rollen und aktuelle Koordinaten nur im laufenden Prozessspeicher.
- Nach deiner Zustimmung sendet die native App den aktuellen Standort fortlaufend, auch außerhalb einer Runde und im Hintergrund. Der Server hält nur den letzten Standort bis zum Stoppen oder bis zu 30 Minuten ohne neue Meldung flüchtig im Arbeitsspeicher. Sucher sehen Hider-Positionen weiterhin nur während eines Pings.
- Beim Stoppen oder Widerrufen der Gerätefreigabe endet die Standortübertragung. Browser können Standortübertragung im Hintergrund pausieren; dafür ist die native App nötig.
- Browser-GPS ist nicht fälschungssicher und kann je nach Gerät ungenau sein.
- Es gibt keine Konten und keine dauerhafte Spielhistorie. Das iPhone-Installationspaket muss mit Xcode gebaut und signiert werden.

## Kurztest

Erstelle in einem Browser eine Lobby und tritt ihr von einem zweiten Browser/Fenster mit dem Code bei. Für GPS auf echten Geräten muss die öffentliche Adresse HTTPS verwenden. In automatisierten Checks wurden Raum-Erstellung, Beitritt, rollenbasierte Standortfreigabe und beide Fangmodi geprüft.
