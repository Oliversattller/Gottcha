import { BackgroundGeolocation } from '@capgo/background-geolocation';
import { Geolocation } from '@capacitor/geolocation';

const TOKEN_KEY = 'gotchaLocationToken';
const getToken = () => {
  let token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(TOKEN_KEY, token);
  }
  return token;
};

window.gotchaLocationToken = getToken;
window.gotchaIsNative = () => !!window.Capacitor?.isNativePlatform?.();
const GOTCHA_SERVER_URL = 'https://gottcha-oliver.onrender.com';
window.gotchaServerUrl = () => (window.gotchaIsNative() || window.location.hostname.endsWith('.pages.dev') || window.location.hostname.endsWith('.vercel.app')) ? GOTCHA_SERVER_URL : window.location.origin;
window.gotchaCurrentPosition = async () => {
  await Geolocation.requestPermissions();
  return Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 });
};
window.gotchaStartNativeLocation = async () => {
  if (!window.gotchaIsNative()) return false;
  const platform = window.Capacitor.getPlatform();
  const permission = await BackgroundGeolocation.requestPermissions({
    permissions: platform === 'ios' ? ['location', 'backgroundLocation'] : ['location', 'notification']
  });
  const backgroundAllowed = platform !== 'ios' || ['granted', 'always'].includes(permission.backgroundLocation);
  if (permission.location !== 'granted' || !backgroundAllowed) {
    throw new Error('Erlaube Gotcha den Standort auch im Hintergrund.');
  }
  const origin = window.gotchaServerUrl();
  await BackgroundGeolocation.start({
    backgroundTitle: 'Gotcha Live · Standort aktiv',
    backgroundMessage: 'Gotcha sendet deinen Standort. In der App kannst du die Freigabe stoppen.',
    requestPermissions: false,
    stale: false,
    distanceFilter: 0,
    minIntervalMs: 4000,
    networkFallback: true,
    url: `${origin}/api/location`,
    headers: { Authorization: `Bearer ${getToken()}` }
  }, (position, error) => {
    if (error) {
      console.error('Gotcha background location:', error);
      return;
    }
    if (position) window.gotchaReceiveNativeLocation?.(position);
  });
  return true;
};

window.gotchaStopNativeLocation = async () => {
  if (!window.gotchaIsNative()) return;
  await BackgroundGeolocation.stop();
  await fetch(`${window.gotchaServerUrl()}/api/location`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getToken()}` }
  }).catch(() => {});
};
