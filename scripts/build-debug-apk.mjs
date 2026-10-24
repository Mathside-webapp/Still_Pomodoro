import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const windows=process.platform==='win32';
const gradlew=windows?'gradlew.bat':'./gradlew';
const gradlePath=`android/${gradlew.replace('./','')}`;
if(!fs.existsSync(gradlePath)){
  console.error('Gradle wrapper missing. Open android/ in Android Studio to install SDK components, or run npm run android:prepare.');
  process.exit(1);
}
if(!windows)fs.chmodSync('android/gradlew',0o755);
const result=spawnSync(gradlew,['assembleDebug'],{cwd:'android',stdio:'inherit',shell:windows});
if(result.status!==0)process.exit(result.status||1);
console.log('APK: android/app/build/outputs/apk/debug/app-debug.apk');
