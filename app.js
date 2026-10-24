(() => {
  'use strict';
  const STORAGE_KEY = 'still-pomodoro-v2';
  const OLD_STORAGE_KEY = 'still-pomodoro-v1';
  const DEFAULT_SETTINGS = {focus:25,short:5,long:15,longAfter:4,sound:true,alarmSound:'gentle',autoStart:false,theme:'light'};
  const SOUND_OPTIONS = [
    ['gentle','Gentle chime'],['bell','Bell tower'],['marimba','Soft marimba'],
    ['digital','Digital ping'],['sunrise','Sunrise melody'],['crystal','Crystal notes'],
    ['classic','Classic alarm'],['ocean','Ocean drops'],['retro','Retro beeps'],['celebrate','Celebration']
  ];
  const SOUND_IDS = new Set(SOUND_OPTIONS.map(([id])=>id));
  const native = window.StillNative || { enabled: false, sync: () => Promise.resolve() };
  if (native.enabled) document.body.classList.add('native-android');
  const CIRCUMFERENCE = Math.PI * 246;
  const $ = id => document.getElementById(id);
  const nodes = {
    time:$('timeValue'),ring:$('ringProgress'),mode:$('ringMode'),hint:$('ringHint'),start:$('startButton'),
    startText:$('startText'),startIcon:$('startIcon'),pips:$('sessionPips'),label:$('sessionLabel'),
    modal:$('settingsModal'),routineModal:$('routineModal'),toast:$('toast'),
    routineList:$('routineList'),routineCount:$('routineCount'),customContext:$('customContext'),
    timeline:$('customTimeline'),timelineList:$('timelineList'),customName:$('activeRoutineName'),
    customNote:$('customProgressNote'),sessions:$('sessionsStat'),minutes:$('minutesStat')
  };
  const tabs = [...document.querySelectorAll('.timer-tab')];
  const getStored = key => {try{return JSON.parse(localStorage.getItem(key)||'null')||{};}catch{return {};}};
  const previous = getStored(STORAGE_KEY);
  const old = getStored(OLD_STORAGE_KEY);
  const stored = Object.keys(previous).length ? previous : old;
  const intInRange = (value,min,max) => {const n=Number(value);return Number.isInteger(n)&&n>=min&&n<=max?n:null;};
  function sanitizeSettings(raw){
    const result={...DEFAULT_SETTINGS};
    for(const [key,min,max] of [['focus',1,180],['short',1,60],['long',1,120]]){
      const n=intInRange(raw[key],min,max);if(n!==null)result[key]=n;
    }
    if([2,3,4,5,6,8].includes(Number(raw.longAfter)))result.longAfter=Number(raw.longAfter);
    for(const key of ['sound','autoStart'])if(typeof raw[key]==='boolean')result[key]=raw[key];
    if(['light','dark'].includes(raw.theme))result.theme=raw.theme;
    if(SOUND_IDS.has(raw.alarmSound))result.alarmSound=raw.alarmSound;
    return result;
  }
  const settings=sanitizeSettings(stored.settings||{});
  const history=Array.isArray(stored.history) ? stored.history.filter(x=>x&&/^\d{4}-\d\d-\d\d$/.test(x.date)&&Number.isFinite(x.minutes)&&x.minutes>0).slice(-2000) : [];
  const cleanTimer=(raw,i)=>{
    if(!raw||!['focus','break'].includes(raw.kind))return null;
    const minutes=intInRange(raw.minutes,1,180);
    if(minutes===null)return null;
    const label=typeof raw.label==='string'?raw.label.trim().slice(0,32):'';
    return {kind:raw.kind,minutes,label:label||`${raw.kind==='focus'?'Focus':'Break'} ${i+1}`,sound:SOUND_IDS.has(raw.sound)?raw.sound:'default'};
  };
  const cleanRoutine=raw=>{
    if(!raw||!Array.isArray(raw.timers)||!raw.timers.length||raw.timers.length>12)return null;
    const repeat=intInRange(raw.rounds,1,20);
    if(repeat===null)return null;
    const timers=raw.timers.map(cleanTimer);
    if(timers.some(x=>!x))return null;
    const name=typeof raw.name==='string'?raw.name.trim().slice(0,45):'';
    return {id:typeof raw.id==='string'&&raw.id.length<100?raw.id:null,name:name||'Untitled session',timers,rounds:repeat};
  };
  let routines=Array.isArray(stored.routines)?stored.routines.slice(0,50).map(cleanRoutine).filter(Boolean).map((r,i)=>({...r,id:r.id||`saved-${i}`})):[];
  const oldTimer=stored.timer||{};
  const state={
    view:stored.view==='stopwatch'?'stopwatch':'pomodoro',
    mode:['focus','short','long'].includes(oldTimer.mode)?oldTimer.mode:'focus',
    durationSeconds:intInRange(oldTimer.durationSeconds,60,10800)||settings[['focus','short','long'].includes(oldTimer.mode)?oldTimer.mode:'focus']*60,
    running:oldTimer.running===true,remaining:0,endTime:Number(oldTimer.endTime)||null,
    focusCount:Math.max(0,Math.min(1000000,Math.floor(Number(stored.focusCount)||0))),
    activeRoutine:null,roundIndex:0,timerIndex:0,done:false
  };
  const routineSave=stored.activeRoutine;
  if(routineSave && typeof routineSave==='object'){
    const snapshot=cleanRoutine(routineSave.snapshot);
    const round=intInRange(routineSave.roundIndex,0,19);
    const timer=intInRange(routineSave.timerIndex,0,11);
    if(snapshot&&round!==null&&timer!==null&&round<snapshot.rounds&&timer<snapshot.timers.length){
      state.activeRoutine=snapshot;state.roundIndex=round;state.timerIndex=timer;state.done=routineSave.done===true;
    }
  }
  const swRaw=stored.stopwatch||{};
  const stopwatch={running:swRaw.running===true,elapsed:Math.max(0,Number(swRaw.elapsed)||0),startedAt:Number(swRaw.startedAt)||null,laps:[]};
  if(Array.isArray(swRaw.laps))stopwatch.laps=swRaw.laps.filter(x=>x&&Number.isFinite(x.elapsed)&&Number.isFinite(x.split)).slice(-200).map(x=>({elapsed:x.elapsed,split:x.split}));
  let toastTimer=null, soundContext=null, saveCounter=0, editorId=null, selectedDelete=null;
  let pendingTimerChange=null, deferredInstallPrompt=null;
  let draftTimers=[];
  const currentTimer=()=>state.activeRoutine?state.activeRoutine.timers[state.timerIndex]:null;
  const totalSeconds=()=>state.activeRoutine?currentTimer().minutes*60:state.durationSeconds;
  const pad=n=>String(n).padStart(2,'0');
  const formatTime=seconds=>{const s=Math.max(0,Math.ceil(seconds));return `${pad(Math.floor(s/60))}:${pad(s%60)}`;};
  const formatStopwatch=ms=>{const hundredths=Math.floor(Math.max(0,ms)/10),seconds=Math.floor(hundredths/100);return `${pad(Math.floor(seconds/60))}:${pad(seconds%60)}<span>.${pad(hundredths%100)}</span>`;};
  const displayDuration=n=>n>=60?`${Math.floor(n/60)}h${n%60?' '+n%60+'m':''}`:`${n}m`;
  const todayKey=()=>{const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;};
  const defaultTime=totalSeconds();
  const remembered=Number(oldTimer.remaining);
  state.remaining=state.done?0:Number.isFinite(remembered)&&remembered>=0&&remembered<=defaultTime?remembered:defaultTime;
  // Switching tools pauses the tool you are leaving, avoiding two simultaneous clocks.
  if(state.view==='stopwatch')state.running=false;
  else stopwatch.running=false;

  function persist(){
    const data={
      settings,history,focusCount:state.focusCount,routines,view:state.view,
      activeRoutine:state.activeRoutine?{snapshot:state.activeRoutine,roundIndex:state.roundIndex,timerIndex:state.timerIndex,done:state.done}:null,
      timer:{mode:state.mode,durationSeconds:state.durationSeconds,running:state.running,remaining:state.remaining,endTime:state.endTime},
      stopwatch:{running:stopwatch.running,elapsed:stopwatch.elapsed,startedAt:stopwatch.startedAt,laps:stopwatch.laps}
    };
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(data));}catch{}
  }
  function toast(message){
    nodes.toast.textContent=message;nodes.toast.classList.add('show');
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>nodes.toast.classList.remove('show'),3300);
  }
  function initAudio(){
    try{
      const AudioCtx=window.AudioContext||window.webkitAudioContext;
      if(!AudioCtx)return null;
      if(!soundContext||soundContext.state==='closed')soundContext=new AudioCtx();
      if(soundContext.state==='suspended')soundContext.resume().catch(()=>{});
      return soundContext;
    }catch{return null;}
  }
  // Audio is synthesized locally with Web Audio; no downloads or audio files are required.
  // Each note has an attack and decay to avoid loud clicks between tones.
  function makeTone(ctx,at,frequency,duration,{wave='sine',volume=.06,glide=0,partials=false}={}){
    const gain=ctx.createGain();gain.connect(ctx.destination);
    const safeVolume=Math.min(.14,Math.max(.001,volume));
    gain.gain.setValueAtTime(.0001,at);
    gain.gain.exponentialRampToValueAtTime(safeVolume,at+.018);
    gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
    const osc=ctx.createOscillator();osc.type=wave;osc.frequency.setValueAtTime(frequency,at);
    if(glide)osc.frequency.exponentialRampToValueAtTime(Math.max(20,frequency*glide),at+duration);
    osc.connect(gain);osc.start(at);osc.stop(at+duration+.02);
    if(partials){
      const overtone=ctx.createOscillator(),g2=ctx.createGain();
      overtone.type='sine';overtone.frequency.setValueAtTime(frequency*2.01,at);
      g2.gain.setValueAtTime(.0001,at);
      g2.gain.exponentialRampToValueAtTime(safeVolume*.25,at+.012);
      g2.gain.exponentialRampToValueAtTime(.0001,at+duration*.75);
      overtone.connect(g2);g2.connect(ctx.destination);overtone.start(at);overtone.stop(at+duration*.75+.02);
    }
  }
  function playSound(id=settings.alarmSound,{force=false}={}){
    // Android notification channels play completion sounds even when the app is asleep.
    // Keep Web Audio for deliberate sound previews only to avoid double alerts.
    if(native.enabled&&!force)return;
    if(!force&&!settings.sound)return;
    const ctx=initAudio();if(!ctx)return;
    try{
      const time=ctx.currentTime+.035;
      const note=(offset,freq,duration,opts)=>makeTone(ctx,time+offset,freq,duration,opts);
      switch(SOUND_IDS.has(id)?id:'gentle'){
        case 'bell':
          note(0,784,1.35,{wave:'sine',volume:.09,partials:true});
          note(.55,523.25,1.45,{wave:'sine',volume:.08,partials:true});
          note(1.1,784,.9,{wave:'sine',volume:.065,partials:true});break;
        case 'marimba':
          [523.25,659.25,783.99,659.25,523.25].forEach((f,i)=>note(i*.2,f,.35,{wave:'triangle',volume:.075}));break;
        case 'digital':
          [880,1320,1760].forEach((f,i)=>note(i*.25,f,.22,{wave:'square',volume:.026}));break;
        case 'sunrise':
          [392,493.88,587.33,783.99,987.77].forEach((f,i)=>note(i*.22,f,.55,{wave:'sine',volume:.055}));break;
        case 'crystal':
          [1174.66,987.77,783.99,587.33,783.99].forEach((f,i)=>note(i*.23,f,.85,{wave:'sine',volume:.048,partials:true}));break;
        case 'classic':
          [0,1,2,3,4,5].forEach(i=>note(i*.23,i%2?659.25:880,.18,{wave:'square',volume:.045}));break;
        case 'ocean':
          [987.77,783.99,659.25,523.25].forEach((f,i)=>note(i*.36,f,1.0,{wave:'sine',volume:.065,glide:.74}));break;
        case 'retro':
          [523.25,523.25,783.99,1046.5,783.99].forEach((f,i)=>note(i*.17,f,.13,{wave:'sawtooth',volume:.03}));break;
        case 'celebrate':
          [523.25,659.25,783.99,1046.5,783.99,1046.5].forEach((f,i)=>note(i*.17,f,i===5?.9:.26,{wave:'triangle',volume:.075}));break;
        case 'gentle':default:
          [523.25,659.25,783.99,1046.5].forEach((f,i)=>note(i*.2,f,.72,{wave:'sine',volume:.067}));break;
      }
    }catch{/* Some browsers may restrict audio, especially in background tabs. */}
  }
  function notify(message){
    if(native.enabled)return;
    if(typeof Notification!=='undefined'&&Notification.permission==='granted'){
      try{new Notification('Still — Pomodoro',{body:message,icon:'favicon.svg'});}catch{}
    }
  }
  function updateStats(){
    const today=history.filter(x=>x.date===todayKey());
    nodes.sessions.textContent=String(today.length);
    nodes.minutes.textContent=String(today.reduce((a,b)=>a+b.minutes,0));
    $('todayDate').textContent=new Intl.DateTimeFormat('en',{month:'short',day:'numeric',year:'numeric'}).format(new Date());
  }
  function renderRoutines(){
    nodes.routineCount.textContent=String(routines.length);
    nodes.routineList.replaceChildren();
    if(!routines.length){
      const empty=document.createElement('div');empty.className='routines-empty';
      empty.innerHTML='<span class="empty-symbol">✳</span><div><strong>No saved sessions yet</strong><p>Build a timer lineup that fits your rhythm.</p></div>';
      nodes.routineList.append(empty);return;
    }
    routines.forEach((routine)=>{
      const total=routine.timers.reduce((sum,t)=>sum+t.minutes,0)*routine.rounds;
      const card=document.createElement('article');card.className='routine-card';
      if(state.activeRoutine?.id===routine.id)card.classList.add('routine-active');
      const content=document.createElement('div');content.className='routine-details';
      const title=document.createElement('strong');title.textContent=routine.name;
      const meta=document.createElement('span');meta.textContent=`${routine.timers.length} timer${routine.timers.length===1?'':'s'} × ${routine.rounds} session${routine.rounds===1?'':'s'} · ${displayDuration(total)}`;
      content.append(title,meta);
      const actions=document.createElement('div');actions.className='routine-actions';
      const launch=document.createElement('button');launch.type='button';launch.className='routine-launch';launch.textContent=state.activeRoutine?.id===routine.id?'Restart':'Start';launch.addEventListener('click',()=>startRoutine(routine));
      const edit=document.createElement('button');edit.type='button';edit.className='mini-icon';edit.setAttribute('aria-label',`Edit ${routine.name}`);edit.title='Edit session';edit.innerHTML='<svg class="icon"><use href="#i-edit"/></svg>';edit.addEventListener('click',()=>openRoutine(routine));
      const del=document.createElement('button');del.type='button';del.className='mini-icon';del.setAttribute('aria-label',`Delete ${routine.name}`);del.title='Delete session';del.innerHTML='<svg class="icon"><use href="#i-trash"/></svg>';del.addEventListener('click',()=>openDelete(routine));
      actions.append(launch,edit,del);card.append(content,actions);nodes.routineList.append(card);
    });
  }
  function renderTimeline(){
    if(!state.activeRoutine)return;
    nodes.timelineList.replaceChildren();
    const sequence=state.activeRoutine.timers;
    sequence.forEach((timer,i)=>{
      const item=document.createElement('div');item.className='timeline-item';
      if(i===state.timerIndex)item.classList.add('current');
      if(state.done||i<state.timerIndex)item.classList.add('passed');
      const num=document.createElement('span');num.className='timeline-num';num.textContent=String(i+1).padStart(2,'0');
      const title=document.createElement('span');title.textContent=timer.label;
      const mins=document.createElement('span');mins.className='timeline-mins';mins.textContent=`${timer.minutes} min`;
      item.append(num,title,mins);nodes.timelineList.append(item);
    });
  }
  function renderCountdown(){
    nodes.time.textContent=formatTime(state.remaining);
    const full=totalSeconds();
    nodes.ring.style.strokeDasharray=String(CIRCUMFERENCE);
    nodes.ring.style.strokeDashoffset=String(CIRCUMFERENCE*(1-Math.max(0,Math.min(1,state.remaining/full))));
    const custom=Boolean(state.activeRoutine);
    $('classicTabs').hidden=custom;nodes.customContext.hidden=!custom;nodes.timeline.hidden=!custom;
    $('restartRoutineButton').hidden=!custom;
    if(custom){
      const routine=state.activeRoutine, timer=currentTimer();
      nodes.customName.textContent=routine.name;
      nodes.customNote.textContent=state.done?`${routine.rounds} of ${routine.rounds} sessions completed`:`Session ${state.roundIndex+1} of ${routine.rounds} · Timer ${state.timerIndex+1} of ${routine.timers.length}`;
      nodes.mode.textContent=state.done?'ALL DONE':timer.kind==='break'?'TIME TO REST':'TIME TO FOCUS';
      nodes.hint.textContent=state.done?'Beautiful work. Enjoy your pause.':state.running?'Stay in your rhythm.':timer.label;
      nodes.startText.textContent=state.done?'Start again':state.running?'Pause':`Start ${timer.kind==='break'?'break':'timer'}`;
      nodes.label.textContent=state.done?'SESSION COMPLETE':`SESSION ${state.roundIndex+1} OF ${routine.rounds}`;
      nodes.pips.replaceChildren(...Array.from({length:routine.rounds},(_,i)=>{const p=document.createElement('span');p.className=`pip${state.done||i<state.roundIndex?' done':i===state.roundIndex?' active':''}`;return p;}));
      nodes.pips.setAttribute('aria-label',`${state.done?routine.rounds:state.roundIndex} of ${routine.rounds} sessions completed`);
      renderTimeline();
    }else{
      const titles={focus:'TIME TO FOCUS',short:'TAKE A BREATHER',long:'REST & RECHARGE'};
      const hints={focus:"You've got this.",short:'A little pause goes a long way.',long:'Enjoy your well-earned break.'};
      nodes.mode.textContent=titles[state.mode];nodes.hint.textContent=state.running?'Stay in your rhythm.':hints[state.mode];
      nodes.startText.textContent=state.running?'Pause':state.mode==='focus'?'Start focus':'Start break';
      const completed=state.focusCount%settings.longAfter;
      nodes.label.textContent=`SESSION ${completed+1} OF ${settings.longAfter}`;
      nodes.pips.replaceChildren(...Array.from({length:settings.longAfter},(_,i)=>{const p=document.createElement('span');p.className=`pip${i<completed?' done':i===completed?' active':''}`;return p;}));
      nodes.pips.setAttribute('aria-label',`${completed} of ${settings.longAfter} focus sessions completed in current cycle`);
    }
    nodes.startIcon.querySelector('use').setAttribute('href',state.running?'#i-pause':'#i-play');
    nodes.start.setAttribute('aria-label',state.running?'Pause countdown':'Start countdown');
    tabs.forEach(t=>{const on=t.dataset.mode===state.mode;t.classList.toggle('active',on);t.setAttribute('aria-selected',String(on));t.tabIndex=on?0:-1;});
    document.title=`${formatTime(state.remaining)} · ${custom?state.activeRoutine.name:state.mode==='focus'?'Focus':'Break'} — Still`;
    updateStats();
  }
  function stopwatchElapsed(){return stopwatch.elapsed+(stopwatch.running&&stopwatch.startedAt?Math.max(0,Date.now()-stopwatch.startedAt):0);}
  function renderStopwatch(full=true){
    $('stopwatchTime').innerHTML=formatStopwatch(stopwatchElapsed());
    if(!full)return;
    $('stopwatchState').textContent=stopwatch.running?'Time is ticking.':stopwatchElapsed()>0?'Ready to continue.':'Ready when you are.';
    const toggle=$('stopwatchToggle');toggle.querySelector('span').textContent=stopwatch.running?'Pause':stopwatchElapsed()>0?'Resume':'Start';
    toggle.querySelector('use').setAttribute('href',stopwatch.running?'#i-pause':'#i-play');
    $('stopwatchLap').disabled=!stopwatch.running;
    $('lapCount').textContent=`${stopwatch.laps.length} recorded`;
    $('lapList').replaceChildren();
    if(!stopwatch.laps.length){const empty=document.createElement('li');empty.className='lap-empty';empty.textContent='Laps will appear here as you go.';$('lapList').append(empty);return;}
    stopwatch.laps.forEach((lap,i)=>{
      const li=document.createElement('li');li.className='lap-item';
      const a=document.createElement('span');a.textContent=`Lap ${pad(i+1)}`;
      const b=document.createElement('span');b.innerHTML=formatStopwatch(lap.split);
      const c=document.createElement('span');c.innerHTML=formatStopwatch(lap.elapsed);
      li.append(a,b,c);$('lapList').prepend(li);
    });
  }
  function renderView(){
    const sw=state.view==='stopwatch';
    $('stopwatchPanel').hidden=!sw;$('countdownPanel').hidden=sw;$('routinesSection').hidden=sw;
    $('pomodoroView').classList.toggle('active',!sw);$('stopwatchView').classList.toggle('active',sw);
    $('pomodoroView').setAttribute('aria-pressed',String(!sw));$('stopwatchView').setAttribute('aria-pressed',String(sw));
    if(sw){renderStopwatch();document.title='Stopwatch — Still';}else renderCountdown();
    renderRoutines();
  }
  function nextMode(){return state.mode==='focus'?(state.focusCount%settings.longAfter===0?'long':'short'):'focus';}
  function logFocus(minutes,finishedAt=Date.now()){const d=new Date(finishedAt);const date=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;history.push({date,minutes});if(history.length>2000)history.splice(0,history.length-2000);}
  function advanceCustom(){
    const r=state.activeRoutine;
    if(state.timerIndex+1<r.timers.length){state.timerIndex++;return false;}
    state.timerIndex=0;
    if(state.roundIndex+1<r.rounds){state.roundIndex++;return false;}
    state.timerIndex=r.timers.length-1;state.done=true;return true;
  }
  // Schedule Android alarms ahead of time. For auto-start sessions every segment
  // is independently scheduled, so breaks still alert while the process sleeps.
  function nativeAlarmPlan(){
    if(!native.enabled||!state.running||!state.endTime||state.done)return [];
    const result=[];
    const add=(at,label,sound,kind,isLast=false)=>result.push({
      at, title:`${label} complete`,
      body:isLast?'All sessions complete. Great work!':kind==='focus'?'Focus complete. Time for your next break.':'Break complete. Ready to focus?',
      sound:sound==='default'?settings.alarmSound:sound,
      muted:!settings.sound
    });
    let deadline=state.endTime;
    if(state.activeRoutine){
      const r=state.activeRoutine;
      for(let round=state.roundIndex;round<r.rounds;round++){
        for(let i=round===state.roundIndex?state.timerIndex:0;i<r.timers.length;i++){
          const timer=r.timers[i];
          if(round!==state.roundIndex||i!==state.timerIndex)deadline+=timer.minutes*60000;
          add(deadline,timer.label,timer.sound,timer.kind,round===r.rounds-1&&i===r.timers.length-1);
          if(!settings.autoStart)return result;
        }
      }
    }else{
      let mode=state.mode,focus=state.focusCount;
      for(let index=0;index<60;index++){
        if(index>0)deadline+=settings[mode]*60000;
        add(deadline,mode==='focus'?'Focus':mode==='short'?'Short break':'Long break',settings.alarmSound,mode==='focus'?'focus':'break');
        if(!settings.autoStart)return result;
        if(mode==='focus')focus++;
        mode=mode==='focus'?(focus%settings.longAfter===0?'long':'short'):'focus';
      }
    }
    return result;
  }
  function syncNativeSchedule(askPermission=false){
    if(native.enabled)void native.sync(nativeAlarmPlan(),askPermission);
  }
  let catchingUp=false;
  function completeTimer(finishedAt=Date.now()){
    if(!state.running)return;
    const custom=Boolean(state.activeRoutine),timer=currentTimer();
    const finishedKind=custom?timer.kind:state.mode==='focus'?'focus':'break';
    if(finishedKind==='focus'){
      logFocus(custom?timer.minutes:state.durationSeconds/60,finishedAt);
      if(!custom)state.focusCount++;
    }
    state.running=false;state.endTime=null;state.remaining=0;
    const fullyDone=custom?advanceCustom():false;
    const message=fullyDone?'All custom sessions completed!':custom?`${timer.label} complete. ${state.done?'Great job!':'Next timer is ready.'}`:finishedKind==='focus'?'Focus complete. Time for a break!':'Break complete. Ready to focus?';
    playSound(custom&&timer.sound!=='default'?timer.sound:settings.alarmSound);notify(message);toast(message);
    if(!custom){state.mode=nextMode();state.durationSeconds=settings[state.mode]*60;}
    if(!fullyDone){state.remaining=totalSeconds();if(settings.autoStart){state.running=true;state.endTime=finishedAt+state.remaining*1000;}}
    persist();renderCountdown();renderRoutines();
    if(!catchingUp)syncNativeSchedule(false);
  }
  function tick(){
    if(state.running){
      // Catch up ALL elapsed auto-start segments, not just one. The original
      // segment deadline is used for transitions, so background time never drifts.
      let processed=0;
      catchingUp=true;
      try {
        while(state.running&&state.endTime<=Date.now()&&processed++<300){
          completeTimer(state.endTime);
        }
      } finally {catchingUp=false;}
      if(processed>1)syncNativeSchedule(false);
      if(state.running)state.remaining=Math.max(0,Math.ceil((state.endTime-Date.now())/1000));
      if(state.running&&state.view==='pomodoro'){
        nodes.time.textContent=formatTime(state.remaining);
        nodes.ring.style.strokeDashoffset=String(CIRCUMFERENCE*(1-state.remaining/totalSeconds()));
        document.title=`${formatTime(state.remaining)} · Still`;
        if(++saveCounter%16===0)persist();
      }
    }
    if(state.view==='stopwatch')renderStopwatch(false);
  }
  function stopCountdown(){
    if(!state.running)return;
    state.remaining=Math.max(0,Math.ceil((state.endTime-Date.now())/1000));state.running=false;state.endTime=null;
  }
  function startPause(){
    if(state.done){restartRoutine();return;}
    if(state.running){
      if(Date.now()>=state.endTime){completeTimer();return;}
      stopCountdown();
    }else{
      if(state.remaining<=0)state.remaining=totalSeconds();
      if(stopwatch.running)pauseStopwatch();
      initAudio();state.running=true;state.endTime=Date.now()+state.remaining*1000;
    }
    persist();renderCountdown();syncNativeSchedule(state.running);
  }
  function reset(){state.running=false;state.endTime=null;state.remaining=totalSeconds();state.done=false;persist();renderCountdown();syncNativeSchedule();toast('Timer reset. A fresh start!');}
  function hasActiveCountdown(){
    // Include a paused countdown that has already made progress.
    if(state.done)return false;
    if(state.running)return Boolean(state.endTime)&&state.endTime>Date.now();
    return state.remaining>0&&state.remaining<totalSeconds();
  }
  function currentTimerName(){
    if(state.activeRoutine)return currentTimer()?.label||'Custom timer';
    return {focus:'Focus',short:'Short break',long:'Long break'}[state.mode]||'Timer';
  }
  function clearTimerSwitchPrompt(){
    pendingTimerChange=null;
    closeModal($('switchTimerModal'),$('startButton'));
  }
  function askToReplaceTimer(nextName,action){
    if(!hasActiveCountdown()){action();return;}
    pendingTimerChange=action;
    $('switchTimerTitle').textContent=state.running?'A timer is already running':'A timer is paused';
    $('switchTimerDescription').textContent=`You have an unfinished ${currentTimerName().toLowerCase()} timer. Do you want to start ${nextName} instead?`;
    $('runningTimerLabel').textContent=currentTimerName();
    $('runningTimeLeft').textContent=`${formatTime(state.running?Math.max(0,Math.ceil((state.endTime-Date.now())/1000)):state.remaining)} left`;
    openModal($('switchTimerModal'),$('keepRunningTimer'));
  }
  function setClassicMode(mode,autostart=false){
    state.mode=mode;state.durationSeconds=settings[mode]*60;state.activeRoutine=null;state.done=false;state.running=false;state.endTime=null;state.remaining=totalSeconds();
    if(autostart){if(stopwatch.running)pauseStopwatch();initAudio();state.running=true;state.endTime=Date.now()+state.remaining*1000;}
    persist();renderView();syncNativeSchedule(autostart);
  }
  function changeMode(mode){
    if(!['focus','short','long'].includes(mode)||(!state.activeRoutine&&state.mode===mode))return;
    const wasActive=hasActiveCountdown();
    const name={focus:'Focus',short:'Short break',long:'Long break'}[mode];
    askToReplaceTimer(name,()=>setClassicMode(mode,wasActive));
  }
  function skip(){
    if(state.activeRoutine){
      const finished=advanceCustom();state.running=false;state.endTime=null;state.remaining=finished?0:totalSeconds();
      toast(finished?'Custom session finished.':'Skipped to the next timer.');
    }else{state.mode=nextMode();state.durationSeconds=settings[state.mode]*60;state.running=false;state.endTime=null;state.remaining=totalSeconds();toast('Moved to the next timer.');}
    persist();renderCountdown();syncNativeSchedule();
  }
  function startRoutine(r){
    const snap=cleanRoutine(r);if(!snap)return;
    const launch=()=>{
      stopCountdown();state.activeRoutine=snap;state.roundIndex=0;state.timerIndex=0;state.done=false;
      state.running=false;state.endTime=null;state.remaining=totalSeconds();
      state.view='pomodoro';persist();renderView();syncNativeSchedule();
      toast(`“${r.name}” is ready to start.`);
      document.querySelector('.timer-card').scrollIntoView({behavior:'smooth',block:'center'});
    };
    askToReplaceTimer(`“${snap.name}”`,launch);
  }
  function restartRoutine(){
    if(!state.activeRoutine)return;
    state.running=false;state.endTime=null;state.done=false;state.roundIndex=0;state.timerIndex=0;state.remaining=totalSeconds();
    persist();renderCountdown();syncNativeSchedule();toast('All sessions restarted.');
  }
  function switchView(view){
    if(view===state.view)return;
    if(view==='stopwatch')stopCountdown();
    else pauseStopwatch();
    state.view=view;persist();renderView();syncNativeSchedule();
  }
  function pauseStopwatch(){
    if(!stopwatch.running)return;
    stopwatch.elapsed=stopwatchElapsed();stopwatch.running=false;stopwatch.startedAt=null;
  }
  function toggleStopwatch(){
    if(stopwatch.running)pauseStopwatch();
    else {stopCountdown();stopwatch.startedAt=Date.now();stopwatch.running=true;}
    persist();renderStopwatch();syncNativeSchedule();
  }
  function resetStopwatch(){stopwatch.running=false;stopwatch.elapsed=0;stopwatch.startedAt=null;stopwatch.laps=[];persist();renderStopwatch();}
  function addLap(){
    if(!stopwatch.running)return;
    const elapsed=stopwatchElapsed(),previous=stopwatch.laps.length?stopwatch.laps[stopwatch.laps.length-1].elapsed:0;
    stopwatch.laps.push({elapsed,split:elapsed-previous});if(stopwatch.laps.length>200)stopwatch.laps.shift();
    persist();renderStopwatch();
  }
  function themeUpdate(){
    const dark=settings.theme==='dark';document.body.classList.toggle('dark',dark);
    $('themeButton').setAttribute('aria-label',dark?'Switch to light mode':'Switch to dark mode');
    $('themeButton').querySelector('use').setAttribute('href',dark?'#i-sun':'#i-moon');
    document.querySelector('meta[name="theme-color"]').content=dark?'#171b25':'#f7f5f0';
  }
  function closeModal(modal,focus){modal.hidden=true;if(![nodes.modal,nodes.routineModal,$('confirmModal'),$('switchTimerModal'),$('installModal')].some(m=>!m.hidden))document.body.style.overflow='';focus?.focus();}
  function openModal(modal,focus){modal.hidden=false;document.body.style.overflow='hidden';focus?.focus();}
  function openSettings(){
    for(const key of ['focus','short','long'])$(`${key}Duration`).value=settings[key];
    $('longAfter').value=String(settings.longAfter);$('soundEnabled').checked=settings.sound;$('alarmSound').value=settings.alarmSound;$('autoStart').checked=settings.autoStart;
    openModal(nodes.modal,$('closeSettings'));
  }
  function updateEditorList(){
    const host=$('timerEditorList');host.replaceChildren();
    draftTimers.forEach((timer,i)=>{
      const card=document.createElement('div');card.className='timer-edit-card';
      const badge=document.createElement('span');badge.className='timer-edit-number';badge.textContent=pad(i+1);
      const fields=document.createElement('div');fields.className='timer-edit-fields';
      const nameLabel=document.createElement('label');nameLabel.textContent='Timer name';
      const name=document.createElement('input');name.type='text';name.maxLength=32;name.placeholder=`Timer ${i+1}`;name.value=timer.label;
      name.addEventListener('input',()=>{draftTimers[i].label=name.value;updateEstimate();});nameLabel.append(name);
      const kindLabel=document.createElement('label');kindLabel.textContent='Type';
      const kind=document.createElement('select');
      for(const [value,label] of [['focus','Focus'],['break','Break']]){const opt=document.createElement('option');opt.value=value;opt.textContent=label;kind.append(opt);}
      kind.value=timer.kind;kind.addEventListener('change',()=>{draftTimers[i].kind=kind.value;});kindLabel.append(kind);
      const durationLabel=document.createElement('label');durationLabel.textContent='Minutes';
      const minutes=document.createElement('input');minutes.type='number';minutes.min='1';minutes.max='180';minutes.step='1';minutes.required=true;minutes.value=String(timer.minutes);
      minutes.addEventListener('input',()=>{draftTimers[i].minutes=Number(minutes.value);updateEstimate();});durationLabel.append(minutes);
      const soundLabel=document.createElement('label');soundLabel.textContent='End sound';
      const sound=document.createElement('select');sound.setAttribute('aria-label',`End sound for timer ${i+1}`);
      const def=document.createElement('option');def.value='default';def.textContent='Use default';sound.append(def);
      SOUND_OPTIONS.forEach(([id,label])=>{const opt=document.createElement('option');opt.value=id;opt.textContent=label;sound.append(opt);});
      sound.value=timer.sound||'default';sound.addEventListener('change',()=>{draftTimers[i].sound=sound.value;});soundLabel.append(sound);
      fields.append(nameLabel,kindLabel,durationLabel,soundLabel);card.append(badge,fields);host.append(card);
    });
    updateEstimate();
  }
  function updateEstimate(){
    const count=intInRange($('roundCount').value,1,20)||0;
    const duration=draftTimers.reduce((sum,t)=>sum+(Number.isFinite(t.minutes)&&t.minutes>=1&&t.minutes<=180?t.minutes:0),0)*count;
    $('routineEstimate').textContent=`Total planned time: ${duration?displayDuration(duration):'—'} · ${draftTimers.length} timer${draftTimers.length===1?'':'s'} per session × ${count||'—'} session${count===1?'':'s'}`;
  }
  function updateTimerCount(){
    const count=intInRange($('timerCount').value,1,12);if(!count)return;
    const oldLength=draftTimers.length;
    while(draftTimers.length<count){const i=draftTimers.length;draftTimers.push({kind:i%2?'break':'focus',minutes:i%2?5:25,label:i%2?`Break ${i+1}`:`Focus ${i+1}`,sound:'default'});}
    draftTimers.length=count;if(oldLength!==count)updateEditorList();else updateEstimate();
  }
  function openRoutine(routine=null){
    editorId=routine?.id||null;
    $('routineTitle').textContent=routine?'Edit session':'Create a session';
    $('saveRoutineLabel').textContent=routine?'Save changes':'Save and start session';
    $('routineName').value=routine?.name||'';
    $('timerCount').value=String(routine?.timers.length||2);
    $('roundCount').value=String(routine?.rounds||4);
    draftTimers=routine?routine.timers.map(t=>({...t})):[{kind:'focus',minutes:25,label:'Focus 1',sound:'default'},{kind:'break',minutes:5,label:'Break 2',sound:'default'}];
    updateEditorList();openModal(nodes.routineModal,$('routineName'));
  }
  function saveRoutine(event){
    event.preventDefault();
    const name=$('routineName').value.trim().slice(0,45);
    const count=intInRange($('timerCount').value,1,12);
    const rounds=intInRange($('roundCount').value,1,20);
    if(!name||!count||!rounds||draftTimers.length!==count){toast('Add a name and valid timer/session counts.');return;}
    const timers=draftTimers.map((t,i)=>cleanTimer(t,i));
    if(timers.some(x=>!x)){toast('Every timer needs a duration between 1 and 180 minutes.');return;}
    let id=editorId;
    if(!id){if(routines.length>=50){toast('You can save up to 50 sessions.');return;}id=typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():`session-${Date.now()}-${Math.floor(Math.random()*1e6)}`;}
    const data={id,name,timers,rounds};
    if(editorId){
      const index=routines.findIndex(x=>x.id===editorId);if(index<0)return;
      routines[index]=data;
      // The running session is a snapshot so editing its saved template won't unexpectedly cut it short.
    }else routines.unshift(data);
    closeModal(nodes.routineModal,$('newRoutineButton'));
    if(!editorId)startRoutine(data);
    else {persist();renderRoutines();toast('Session changes saved.');}
  }
  function openDelete(r){selectedDelete=r.id;$('confirmDescription').textContent=`“${r.name}” will be removed from your saved sessions. An already active session can still finish.`;openModal($('confirmModal'),$('cancelDelete'));}
  function deleteRoutine(){
    routines=routines.filter(r=>r.id!==selectedDelete);selectedDelete=null;
    closeModal($('confirmModal'),$('newRoutineButton'));persist();renderRoutines();toast('Saved session deleted.');
  }
  if(native.enabled){
    const panel=$('nativeAlarms');panel.hidden=false;
    const status=$('nativeAlarmStatus');
    $('enableAlarmButton').addEventListener('click',()=>void native.enableAlarms());
    window.addEventListener('still-native-status',event=>{
      if(status)status.textContent=event.detail.text;
      if(['denied','error'].includes(event.detail.kind))toast(event.detail.text);
    });
    window.addEventListener('still-native-resume',()=>{tick();syncNativeSchedule();});
    $('installButton').hidden=true;
    document.querySelector('.settings-note').textContent = 'On Android, timer-completion alerts use local notifications. For best lock-screen reliability, enable Notifications and Alarms & reminders in system settings. The timer itself stays accurate using saved deadlines, even if Android delays a sound. Preferences and session history stay on this device.';
  }
  $('pomodoroView').addEventListener('click',()=>switchView('pomodoro'));
  $('stopwatchView').addEventListener('click',()=>switchView('stopwatch'));
  $('stopwatchToggle').addEventListener('click',toggleStopwatch);
  $('stopwatchReset').addEventListener('click',resetStopwatch);
  $('stopwatchLap').addEventListener('click',addLap);
  $('startButton').addEventListener('click',startPause);
  $('resetButton').addEventListener('click',reset);
  $('skipButton').addEventListener('click',skip);
  $('restartRoutineButton').addEventListener('click',restartRoutine);
  $('exitCustom').addEventListener('click',()=>askToReplaceTimer('the classic Focus timer',()=>setClassicMode('focus',false)));
  tabs.forEach(t=>t.addEventListener('click',()=>changeMode(t.dataset.mode)));
  $('themeButton').addEventListener('click',()=>{settings.theme=settings.theme==='light'?'dark':'light';themeUpdate();persist();});
  $('settingsButton').addEventListener('click',openSettings);
  $('previewSound').addEventListener('click',()=>playSound($('alarmSound').value,{force:true}));
  $('closeSettings').addEventListener('click',()=>closeModal(nodes.modal,$('settingsButton')));
  $('newRoutineButton').addEventListener('click',()=>openRoutine());
  $('closeRoutine').addEventListener('click',()=>closeModal(nodes.routineModal,$('newRoutineButton')));
  $('timerCount').addEventListener('input',updateTimerCount);
  $('roundCount').addEventListener('input',updateEstimate);
  $('routineForm').addEventListener('submit',saveRoutine);
  $('closeConfirm').addEventListener('click',()=>closeModal($('confirmModal'),$('newRoutineButton')));
  $('cancelDelete').addEventListener('click',()=>closeModal($('confirmModal'),$('newRoutineButton')));
  $('confirmDelete').addEventListener('click',deleteRoutine);
  $('keepRunningTimer').addEventListener('click',clearTimerSwitchPrompt);
  $('closeSwitchTimer').addEventListener('click',clearTimerSwitchPrompt);
  $('startNewTimer').addEventListener('click',()=>{
    const action=pendingTimerChange;
    pendingTimerChange=null;
    closeModal($('switchTimerModal'));
    if(typeof action==='function')action();
  });
  $('installButton').addEventListener('click',async()=>{
    if(deferredInstallPrompt){
      const prompt=deferredInstallPrompt;deferredInstallPrompt=null;
      try{await prompt.prompt();await prompt.userChoice;}catch{openModal($('installModal'),$('closeInstall'));}
      return;
    }
    openModal($('installModal'),$('closeInstall'));
  });
  $('closeInstall').addEventListener('click',()=>closeModal($('installModal'),$('installButton')));
  $('installDone').addEventListener('click',()=>closeModal($('installModal'),$('installButton')));
  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault();deferredInstallPrompt=event;
    $('installButton').title='Install Still on this device';
  });
  window.addEventListener('appinstalled',()=>{
    deferredInstallPrompt=null;
    $('installButton').hidden=true;
    toast('Still is installed! You can open it offline.');
  });
  if(window.matchMedia?.('(display-mode: standalone)').matches||window.navigator.standalone){
    $('installButton').hidden=true;
    document.querySelector('.settings-note').textContent = 'On Android, timer-completion alerts use local notifications. For best lock-screen reliability, enable Notifications and Alarms & reminders in system settings. The timer itself stays accurate using saved deadlines, even if Android delays a sound. Preferences and session history stay on this device.';
  }
  if(!native.enabled&&'serviceWorker' in navigator&&(location.protocol==='https:'||location.hostname==='localhost'||location.hostname==='127.0.0.1')){
    window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
  }
  [nodes.modal,nodes.routineModal,$('confirmModal'),$('switchTimerModal'),$('installModal')].forEach(modal=>modal.addEventListener('click',event=>{
    if(event.target!==modal)return;
    if(modal===$('switchTimerModal'))clearTimerSwitchPrompt();
    else if(modal===$('installModal'))closeModal(modal,$('installButton'));
    else {const target=modal===nodes.modal?$('settingsButton'):$('newRoutineButton');closeModal(modal,target);}
  }));
  $('settingsForm').addEventListener('submit',event=>{
    event.preventDefault();
    const v={focus:Number($('focusDuration').value),short:Number($('shortDuration').value),long:Number($('longDuration').value),longAfter:Number($('longAfter').value)};
    if(!intInRange(v.focus,1,180)||!intInRange(v.short,1,60)||!intInRange(v.long,1,120)||![2,3,4,5,6,8].includes(v.longAfter)){
      toast('Please use valid settings.');return;
    }
    const activeDurationChanged=!state.activeRoutine&&settings[state.mode]!==v[state.mode];
    const confirmRestart=activeDurationChanged&&hasActiveCountdown();
    Object.assign(settings,v,{sound:$('soundEnabled').checked,alarmSound:$('alarmSound').value,autoStart:$('autoStart').checked});
    closeModal(nodes.modal,$('settingsButton'));
    // Each active timer has its own original duration so a settings edit never
    // silently changes its deadline or progress.
    if(confirmRestart){
      askToReplaceTimer('a fresh timer using the new duration',()=>setClassicMode(state.mode,true));
    }else if(!state.activeRoutine&&!hasActiveCountdown()){
      state.durationSeconds=settings[state.mode]*60;
      state.remaining=totalSeconds();
    }
    persist();renderCountdown();syncNativeSchedule();toast('Timer settings saved.');
  });
  document.addEventListener('keydown',event=>{
    const open=[nodes.modal,nodes.routineModal,$('confirmModal'),$('switchTimerModal'),$('installModal')].find(m=>!m.hidden);
    if(open){if(event.key==='Escape'){
      event.preventDefault();
      if(open===$('switchTimerModal'))clearTimerSwitchPrompt();
      else closeModal(open,open===nodes.modal?$('settingsButton'):open===$('installModal')?$('installButton'):$('newRoutineButton'));
    }return;}
    if(event.target.closest('button,input,select,textarea,[contenteditable="true"]'))return;
    if(event.code==='Space'){event.preventDefault();if(state.view==='stopwatch')toggleStopwatch();else startPause();}
    if(event.key.toLowerCase()==='r'&&!event.ctrlKey&&!event.metaKey){event.preventDefault();if(state.view==='stopwatch')resetStopwatch();else reset();}
    if(state.view==='pomodoro'&&!state.activeRoutine&&['1','2','3'].includes(event.key))changeMode({1:'focus',2:'short',3:'long'}[event.key]);
  });
  window.addEventListener('focus',tick);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick();});
  window.addEventListener('pagehide',persist);
  // If a countdown expired while the page was closed, complete that timer on reopen.
  if(state.running){
    if(state.endTime>Date.now())state.remaining=Math.ceil((state.endTime-Date.now())/1000);
    else tick();
  }
  if(stopwatch.running&&!stopwatch.startedAt)stopwatch.running=false;
  themeUpdate();renderView();setInterval(tick,100);
  syncNativeSchedule(false);
})();
