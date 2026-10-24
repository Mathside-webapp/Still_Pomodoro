const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const code=fs.readFileSync(require('node:path').join(__dirname,'..','app.js'),'utf8');
const part=code.match(/  function nativeAlarmPlan\(\)\{[\s\S]*?\n  \}\n  function syncNativeSchedule/);
assert(part,'Could not find native alarm planner');
const src=part[0].replace(/\n  function syncNativeSchedule$/,'');
function planner(state,settings){
 const ctx={state,settings,native:{enabled:true}};
 vm.runInNewContext(src+'\nthis.plan=nativeAlarmPlan();',ctx);
 return JSON.parse(JSON.stringify(ctx.plan));
}
const settings={focus:25,short:5,long:15,longAfter:4,sound:true,alarmSound:'gentle',autoStart:false};
const at=Date.now()+25000;
let s={running:true,done:false,endTime:at,activeRoutine:null,mode:'focus',focusCount:0};
let p=planner(s,settings);
assert.equal(p.length,1);assert.equal(p[0].at,at);assert.equal(p[0].sound,'gentle');
assert.equal(p[0].title,'Focus complete');
p=planner({...s,focusCount:3},{...settings,autoStart:true});
assert.equal(p.length,60);
assert.equal(p[1].at,at+15*60000); // long break after fourth focus
assert.equal(p[1].title,'Long break complete');
assert.equal(p[2].at,at+(15+25)*60000);
const routine={name:'My focus session',rounds:3,timers:[
 {minutes:25,kind:'focus',label:'Work',sound:'retro'},
 {minutes:5,kind:'break',label:'Rest',sound:'bell'}
]};
s={running:true,done:false,endTime:at,activeRoutine:routine,roundIndex:0,timerIndex:0};
p=planner(s,{...settings,autoStart:true});
assert.equal(p.length,6);
assert.deepEqual(p.map(x=>x.sound),['retro','bell','retro','bell','retro','bell']);
assert.equal(p.at(-1).at,at+(5+25+5+25+5)*60000);
assert.equal(p.at(-1).body,'All sessions complete. Great work!');
p=planner({...s,roundIndex:1,timerIndex:1},{...settings,autoStart:true,sound:false});
assert.equal(p.length,3);
assert.ok(p.every(x=>x.muted));
assert.equal(planner({...s,running:false},settings).length,0);
console.log('PASS: classic alarm planning, long break, custom rounds, 10-sound selection path, muted mode, pause cancellation.');
