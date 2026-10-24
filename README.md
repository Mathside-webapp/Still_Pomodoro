# Still Pomodoro for Android

**Capacitor 8 Android source project** built from the existing Still Pomodoro v3 web app. The minimalist UI, classic focus / short / long timers, custom repeatable sessions, ten sound options, stopwatch laps, local progress, and theme switching are retained.

**This is a ready-to-prepare source project, not a precompiled APK.** The official Android Gradle platform is generated on your Windows PC by `npm run android:prepare` after the first `npm install`. Native manifest permissions, alarm sounds, and launcher icons are automatically copied into that project. You can build a real APK locally with Android Studio.

## Install on Windows (first time only)

1. Install [Node.js 22+](https://nodejs.org/) and [Android Studio 2025.2.1+](https://developer.android.com/studio). Install the Android SDK (including API 36) through Android Studio's SDK Manager. Android Studio includes a suitable JDK.
2. Extract this ZIP to a normal folder such as `C:\\Projects\\Still-Android`.
3. Open **PowerShell** or a terminal **inside that folder**.
4. Run:

   ```powershell
   npm install
   npm run android:prepare
   npm run android:open
   ```

5. In Android Studio wait for Gradle sync, connect your Android phone with USB debugging enabled (or select an emulator), then click **Run**.
6. To generate an installable debug APK, use **Build > Build Bundle(s) / APK(s) > Build APK(s)** in Android Studio, or from the project root run:

   ```powershell
   npm run android:apk
   ```

7. Debug APK output: `android/app/build/outputs/apk/debug/app-debug.apk`. Copy the APK to your Android phone and install it. You may need to enable **Install unknown apps** for the app used to open the APK.

No server, domain, database, cloud account, or continuous internet connection is needed on the phone. An internet connection is required on the development computer once to install npm/Gradle/SDK dependencies.

## Offline and locked-screen alarms

- UI content and 10 notification sounds are packaged in the APK.
- Each started countdown is anchored to a wall-clock **end timestamp** saved locally. When Android suspends the app, the display catches up accurately once the app returns.
- Android local notifications are scheduled when a timer starts. Auto-start sequences schedule **each future segment** ahead of time, so breaks and focus transitions are accounted for even while the WebView is asleep.
- Pause, reset, replace timer, skip, stopwatch mode, and session switching **cancel or replace pending alarms**.
- On Android 13+, grant the Notifications runtime permission. For timely alarms on Android 12+, grant **Alarms & reminders** when offered. Go to Still > Settings > **Enable background alarms** if needed.
- The ten notification channels use bundled WAV files, one channel per selectable sound. Android 8+ allows users to override channel sounds in the system's notification settings. Apps cannot forcibly override those system choices.
- When notifications are disabled, the countdown still keeps accurate time, but you may not hear an alert while Still is in the background.
- Android power saving / Doze / manufacturer restrictions may delay alarms, particularly if several short intervals fire while idle. This project **does not guarantee second-exact lock-screen audio** on every phone. The UI remains correct on reopening. Force-stopping an app can prevent scheduled alerts until it is opened again.
- The preview button uses browser-synthesized sound; the Android notification uses its own offline WAV rendition of the same named sound.

## Project files

- `index.html`, `styles.css`, `app.js` — preserved Still interface and timer state with Android support.
- `native-entry.js` — native Capacitor bridge, permissions, local alarm channels, cancel/reschedule logic, and app-resume handling.
- `capacitor.config.json` — Android app ID `app.still.pomodoro`, display name and notification defaults.
- `native-assets/android/app/src/main/res/raw/` — ten offline WAV alert sounds.
- `native-assets/android/app/src/main/res/mipmap-*` — launcher icons.
- `native-assets/android/app/src/main/res/drawable-*` — monochrome notification icons.
- `scripts/prepare-android.mjs` — generates/synchronizes Capacitor's official `android/` Gradle project.
- `scripts/apply-android-resources.mjs` — merges the native resources and required Android manifest permissions.
- `preview-browser/` — optional non-native browser version that still works with a double-click on `index.html` (background alarms are browser-limited here).
- `tests/plan.test.cjs` — verification for custom scheduling, classic breaks, and cancellation logic.

## Ongoing development

Edit `index.html`, `styles.css`, or `app.js`, then run:

```powershell
npm run android:sync
npm run android:open
```

For a quick web-development preview after installing npm dependencies, use `npm run dev`. This is not a replacement for verifying native Android behavior on a real phone.

If you plan to publish on Google Play, change the application ID in `capacitor.config.json` *before generating a platform*, create your own release signing key, and verify the latest Google Play policies regarding exact-alarm permissions and target SDK. A signed release uses `Build > Generate Signed Bundle / APK...`, not the debug APK.

## Automated checks and what remains to test

`npm test` checks the JS alarm-planning logic without a browser or Android SDK. JavaScript syntax and WAV file structure can be checked offline. The actual Gradle build, notifications, audio channel behavior, Doze performance, and Android lock-screen appearance **must be tested on an Android device** after building. None of those device-level tests can be substituted by browser-only tests.

## Privacy

Still does not require an account, location, camera, contacts, or a server. The app stores settings, stopwatch laps, saved sessions and daily focus history locally. Installing this Android app does not automatically import data from an existing Chrome/PWA version because Android WebView storage belongs to a different app origin.
