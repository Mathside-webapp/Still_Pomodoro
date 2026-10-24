/** Still's native bridge. Loaded by Vite before the original app module. */
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { App } from '@capacitor/app';
import { StatusBar } from '@capacitor/status-bar';

const nativeAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
const IDS = Object.freeze({ first: 230000, last: 230300 });
const SOUNDS = [
  'gentle', 'bell', 'marimba', 'digital', 'sunrise',
  'crystal', 'classic', 'ocean', 'retro', 'celebrate'
];
const channel = sound => `still_${sound}`;
let pendingOperation = Promise.resolve();
let generation = 0;
let currentPlan = [];
let currentlyActive = true;
let channelsReady = false;

function emitStatus(kind, text) {
  window.dispatchEvent(new CustomEvent('still-native-status', {detail: {kind, text}}));
}
async function permissions(promptUser) {
  let p = await LocalNotifications.checkPermissions();
  if (p.display !== 'granted' && promptUser) p = await LocalNotifications.requestPermissions();
  if (p.display !== 'granted') {
    emitStatus('denied', 'Notifications are disabled. Enable notifications in Android Settings for lock-screen alerts.');
    return false;
  }
  return true;
}
async function exactStatus() {
  try {
    const p = await LocalNotifications.checkExactNotificationSetting();
    if (p.exact_alarm !== 'granted') {
      emitStatus('inexact', 'Exact alarms are disabled. Android may delay timer notifications. Tap Enable background alarms in Settings.');
      return false;
    }
    emitStatus('ready', 'Background notifications are enabled.');
    return true;
  } catch {
    // On older Android versions an exact-alarm toggle does not exist.
    return true;
  }
}
async function cancelOurPending() {
  const {notifications = []} = await LocalNotifications.getPending();
  const mine = notifications.filter(n => n.id >= IDS.first && n.id <= IDS.last);
  if (mine.length) await LocalNotifications.cancel({notifications: mine.map(n => ({id:n.id}))});
}
async function ensureChannels() {
  if (channelsReady) return;
  for (const sound of SOUNDS) {
    await LocalNotifications.createChannel({
      id: channel(sound),
      name: `Still · ${sound[0].toUpperCase()}${sound.slice(1)}`,
      description: `Timer finished: ${sound} sound`,
      importance: 4,
      visibility: 1,
      vibration: false,
      sound: `still_${sound}.wav`
    });
  }
  await LocalNotifications.createChannel({
    id: 'still_silent', name: 'Still · Silent timer alerts',
    description: 'Completion notifications without sounds',
    importance: 3, visibility: 1, vibration: false
  });
  channelsReady = true;
}
async function performSync(events, promptUser, rev) {
  if (!nativeAndroid) return;
  try {
    await ensureChannels();
    await cancelOurPending();
    if (rev !== generation || !events.length) return;
    if (!await permissions(promptUser)) return;
    const exact = await exactStatus();
    if (rev !== generation) return;
    const now = Date.now();
    const planned = events.filter(e => e.at > now + 100).slice(0, IDS.last - IDS.first + 1);
    if (!planned.length) return;
    await LocalNotifications.schedule({notifications:planned.map((event, i) => ({
      id: IDS.first + i,
      title: event.title || 'Still · Timer complete',
      body: event.body || 'Your next timer is ready.',
      channelId: event.muted ? 'still_silent' : channel(SOUNDS.includes(event.sound) ? event.sound : 'gentle'),
      schedule: {at: new Date(event.at), allowWhileIdle: true},
      // Version 8.3+ supports this field; an inexact fallback is intentional
      // when Android has not granted exact-alarm permission.
      isExactNotification: exact,
      smallIcon: 'ic_still_notification',
      iconColor: '#C86B59',
      autoCancel: true,
      extra: {stillTimer: true, sequence: i}
    }))});
    if (rev !== generation) {
      // A newer pause/reset operation is already queued and will cancel these.
      return;
    }
  } catch (error) {
    emitStatus('error', `Could not schedule Android alarms: ${String(error?.message || error)}`);
  }
}
const StillNative = {
  enabled: nativeAndroid,
  // Queuing ensures rapid pause/resume/reset actions cannot leave stale alarms.
  sync(events, askPermission = false) {
    if (!nativeAndroid) return Promise.resolve();
    currentPlan = Array.isArray(events) ? events : [];
    const rev = ++generation;
    const snapshot = currentPlan.slice();
    pendingOperation = pendingOperation.catch(() => {}).then(() => performSync(snapshot, askPermission, rev));
    return pendingOperation;
  },
  async enableAlarms() {
    if (!nativeAndroid) return;
    try {
      if (!await permissions(true)) return;
      const granted = await exactStatus();
      if (!granted) await LocalNotifications.changeExactNotificationSetting();
      else this.sync(currentPlan, false);
    } catch (e) {
      emitStatus('error', `Could not open alarm settings: ${String(e?.message || e)}`);
    }
  },
  async inspect() {
    if (!nativeAndroid) return;
    try {
      if (await permissions(false)) await exactStatus();
    } catch (e) { emitStatus('error', String(e?.message || e)); }
  }
};
window.StillNative = StillNative;
if (nativeAndroid) {
  // Keep the existing responsive content full-height without a visible system status bar.
  StatusBar.hide().catch(() => {});
  App.addListener('appStateChange', ({isActive}) => {
    currentlyActive = isActive;
    if (isActive) {
      window.dispatchEvent(new Event('still-native-resume'));
      StillNative.sync(currentPlan, false);
    }
  });
  App.addListener('resume', () => {
    if (!currentlyActive) return;
    window.dispatchEvent(new Event('still-native-resume'));
  });
  LocalNotifications.addListener('localNotificationActionPerformed', () => {
    window.dispatchEvent(new Event('still-native-resume'));
  });
}

// Import the existing interface only after the native adapter is available.
await import('./app.js');
if (nativeAndroid) StillNative.inspect();
