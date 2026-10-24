import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const android = path.join(base, 'android');
const template = path.join(base, 'native-assets', 'android');
if (!fs.existsSync(path.join(android, 'app/src/main/AndroidManifest.xml'))) {
  console.error('Missing Android project. Run: npm run android:prepare');
  process.exit(1);
}
function copyTree(from,to){
  for(const entry of fs.readdirSync(from,{withFileTypes:true})){
    const source=path.join(from,entry.name),dest=path.join(to,entry.name);
    if(entry.isDirectory()){fs.mkdirSync(dest,{recursive:true});copyTree(source,dest);}
    else fs.copyFileSync(source,dest);
  }
}
copyTree(template, android);
const file=path.join(android,'app/src/main/AndroidManifest.xml');
let xml=fs.readFileSync(file,'utf8');
for (const permission of ['android.permission.POST_NOTIFICATIONS','android.permission.SCHEDULE_EXACT_ALARM']) {
  if (!xml.includes(`android:name="${permission}"`)) {
    xml=xml.replace(/<application\b/,`<uses-permission android:name="${permission}" />\n    <application`);
  }
}
// Minimal purpose-specific permissions: user can disable exact alarms and
// notifications from Android Settings. No camera, contacts, or location access.
fs.writeFileSync(file,xml);
console.log('Still Android: custom WAV channels, icons and alarm permissions applied.');
