import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const windows=process.platform==='win32';
const npx=windows?'npx.cmd':'npx';
function run(args) {
  const result=spawnSync(npx,args,{stdio:'inherit'});
  if(result.status!==0) process.exit(result.status||1);
}
if(!fs.existsSync('android/settings.gradle')){
  console.log('Generating official Capacitor Android project...');
  run(['cap','add','android']);
}else{
  console.log('Existing Android platform detected; syncing web content and plugins...');
  run(['cap','sync','android']);
}
run(['cap','sync','android']);
const node=spawnSync(process.execPath,['scripts/apply-android-resources.mjs'],{stdio:'inherit'});
process.exit(node.status||0);
