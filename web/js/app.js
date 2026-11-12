import { MODE_DEFAULTS, normalizeSettings, loadSettings, saveSettings, formatTime } from './settings.js';
import { NativeEngine } from './native.js';
import { setupOffline } from './offline.js';

// Keep asynchronous loading inside a function: factory Android WebViews cannot
// parse top-level await. The distributed IIFE also lowers newer module syntax.
async function bootstrap(){
// Grid gap support does not imply flex gap (factory WebViews have the former).
const gapProbe=document.createElement('div');gapProbe.id='flexGapProbe';
gapProbe.style.cssText='position:absolute;visibility:hidden;display:flex;flex-direction:column;row-gap:1px';
for(let i=0;i<2;i++){const child=document.createElement('div');child.style.height='1px';gapProbe.appendChild(child);}
document.body.appendChild(gapProbe);
document.documentElement.classList.toggle('no-flex-gap',gapProbe.scrollHeight!==3);
gapProbe.remove();
const native=Boolean(window.NativeAudio);
const engine=native?new NativeEngine(window.NativeAudio):new (await import('./audio.js')).StillwaveEngine();
const $ = id => document.getElementById(id);
let settings=loadSettings(), state={playing:false,elapsed:0}, busy=false, hasSession=false;
const descriptions={
  focus:['Room to think','Soft layers. A steady undercurrent. Nothing to chase.'],
  relax:['Let the edges soften','Unhurried chords, with room between every note.'],
  sleep:['Somewhere softer','A low, slow soundscape. Let the rest wait.'],
  meditate:['Here, for a while','An open space to listen. One moment at a time.'],
};
const canvas=$('signalCanvas'),paint=canvas.getContext('2d');
const reducedMotion=window.matchMedia?window.matchMedia('(prefers-reduced-motion: reduce)'):null;
let visualFrame=0,lastVisualTime=0;
const measured=!native&&typeof engine.getVisualizationData==='function';
function motionAllowed(){return Boolean(paint&&settings.visualizer&&settings.motionEnabled&&state.playing&&!document.hidden&&!(reducedMotion&&reducedMotion.matches)&&(native||measured));}
function drawSignal(time=0){
  if(!paint||!settings.visualizer||document.hidden)return;
  const box=canvas.getBoundingClientRect();if(!box.width||!box.height)return;
  const ratio=Math.min(window.devicePixelRatio||1,2),w=box.width,h=box.height;
  const width=Math.round(w*ratio),height=Math.round(h*ratio);
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
  paint.setTransform(ratio,0,0,ratio,0,0);
  const colors=getComputedStyle(document.documentElement);
  paint.fillStyle=colors.getPropertyValue('--paper').trim();paint.fillRect(0,0,w,h);
  paint.strokeStyle=colors.getPropertyValue('--line').trim();paint.lineWidth=.5;
  paint.beginPath();
  for(let x=0;x<=w;x+=w/6){paint.moveTo(x,0);paint.lineTo(x,h);}
  for(let y=h/4;y<h;y+=h/4){paint.moveTo(0,y);paint.lineTo(w,y);}
  paint.stroke();
  let samples=null;
  if(measured)try{samples=engine.getVisualizationData();}catch(error){samples=null;}
  paint.strokeStyle=colors.getPropertyValue('--accent').trim();paint.lineWidth=1.7;paint.beginPath();
  const count=samples&&samples.length?samples.length:128;
  for(let i=0;i<count;i++){
    const x=i/(count-1)*w;
    // Native bridge has no output analyser. This is only the labeled AM recipe.
    const value=native?settings.intensity*Math.sin(2*Math.PI*(i/(count-1)*settings.rateHz*.25+time/1000)):(samples&&samples.length?(samples[i]-128)/128:0);
    const y=h/2-value*h*.42;
    if(i===0)paint.moveTo(x,y);else paint.lineTo(x,y);
  }
  paint.stroke();
}
function animateSignal(time){
  visualFrame=0;
  if(!motionAllowed())return;
  if(time-lastVisualTime>=50){drawSignal(time);lastVisualTime=time;}
  visualFrame=requestAnimationFrame(animateSignal);
}
function syncVisualization(force=false){
  const running=motionAllowed();
  canvas.setAttribute('data-source',native?'illustrative':measured?'measured':'unavailable');
  canvas.setAttribute('data-running',String(running));
  const status=state.playing?'live':hasSession?'paused':'idle';
  $('signalLabel').textContent=native?`Modulation sketch · not output measurement / ${status}`:measured?`Output waveform · software signal / ${status}`:'Signal display unavailable · no output analyser';
  if(!running&&visualFrame){cancelAnimationFrame(visualFrame);visualFrame=0;}
  if(force||!canvas.getAttribute('data-drawn')){drawSignal();canvas.setAttribute('data-drawn','true');}
  if(running&&!visualFrame)visualFrame=requestAnimationFrame(animateSignal);
}
window.addEventListener('resize',()=>syncVisualization(true));
if(reducedMotion){
  if(reducedMotion.addEventListener)reducedMotion.addEventListener('change',()=>syncVisualization(true));
  else if(reducedMotion.addListener)reducedMotion.addListener(()=>syncVisualization(true));
}
function announce(message,error=false){
  if($('playbackStatus').textContent!==message)$('playbackStatus').textContent=message;
  $('playbackStatus').classList.toggle('error',error);
}
function persist(){
  const saved=saveSettings(settings);
  $('storageStatus').textContent=saved?'':'Preferences cannot be saved in this browser. Sound still works.';
  if(!saved)$('uiStatus').textContent='Applied for this visit only. Storage is unavailable.';
  return saved;
}
const rangeKeys=['volume','intensity','rateHz','ambienceVolume','brightness','space','stereo','density','musicVolume','bassVolume','melodyVolume'];
const styleDescriptions={ambient:'Evolving, sustained layers.',lofi:'Soft-edged harmony with a quieter, close-up feel.',deep:'Lower, darker layers with less upper detail.',glass:'Light, bell-like notes and open space.',drift:'Longer phrases and an unhurried arrangement.',tape:'Rounded tone and gently shifting sustained notes.'};
const uiKeys=['theme','uiDensity','textScale','motionEnabled','visualizer'];
function applyPresentation(){
  const root=document.documentElement;
  root.setAttribute('data-theme',settings.theme);
  root.setAttribute('data-density',settings.uiDensity);
  root.setAttribute('data-motion',settings.motionEnabled?'system':'off');
  root.style.setProperty('--text-scale',settings.textScale);
  for(const key of uiKeys)$(key).value=String(settings[key]);
  $('signalDisplay').hidden=!settings.visualizer;
  document.querySelector('meta[name="theme-color"]').content=getComputedStyle(root).getPropertyValue('--paper').trim();
}
function renderSettings(){
  applyPresentation();
  for(const key of ['duration','ambience','synth','seed',...rangeKeys]){
    const element=$(key);element.value=settings[key];
    if(element.type==='range')element.style.setProperty('--fill',`${(settings[key]-Number(element.min))/(Number(element.max)-Number(element.min))*100}%`);
  }
  for(const key of rangeKeys.filter(key=>key!=='rateHz'))$(key+'Value').textContent=`${Math.round(settings[key]*100)}%`;
  $('styleHelp').textContent=styleDescriptions[settings.style];
  $('rateHzValue').textContent=`${settings.rateHz} Hz`;
  document.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===settings.mode)));
  document.querySelectorAll('[data-style]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.style===settings.style)));
  $('soundCategory').textContent=`${settings.mode.toUpperCase()} / ${settings.style==='lofi'?'LO-FI':settings.style.toUpperCase()}`;
  [$('soundTitle').textContent,$('soundDescription').textContent]=descriptions[settings.mode];
  $('total').textContent=settings.duration?` / ${formatTime(settings.duration*60)}`:' / ∞';
  $('clockNote').textContent=settings.mode==='focus'&&settings.rateHz===16?'16 pulses per beat on a 60 BPM musical clock.':'Experimental independent modulation: the musical clock is not rate-derived. Depth 0% turns modulation off.';
  renderState();syncVisualization(true);
}
function renderState(){
  const playing=Boolean(state.playing),elapsed=Number(state.elapsed)||0;
  document.body.classList.toggle('is-playing',playing);
  $('elapsed').textContent=formatTime(elapsed);
  $('progress').max=settings.duration?settings.duration*60:1;
  $('progress').value=settings.duration?Math.min(elapsed,settings.duration*60):0;
  $('progress').setAttribute('aria-valuetext',settings.duration?`${formatTime(elapsed)} of ${settings.duration} minutes`:`${formatTime(elapsed)} elapsed, no timer`);
  const label=playing?'Pause session':hasSession||elapsed>0?'Resume session':'Start session';
  $('playLabel').textContent=busy?'One moment…':label;$('playButton').setAttribute('aria-label',label);
  $('playButton').disabled=busy;$('newSound').disabled=busy;
  $('playIcon').textContent=playing?'Ⅱ':'▶';
  $('stopButton').disabled=busy||(!playing&&!hasSession&&elapsed===0);
  syncVisualization();
}
function readState(){
  try{
    const next=engine.getState();
    const ended=hasSession&&state.playing&&!next.playing&&next.elapsed===0;
    state=next;
    if(next.playing){hasSession=true;announce('Playing · generated on this device.');}
    else if(ended){hasSession=false;announce('Session complete. Take a little quiet with you.');}
    else if(hasSession&&!next.playing&&!next.error)announce('Paused. Your place is saved.');
    if(next.error)announce(next.error,true);
    renderState();
  }catch(error){announce(`Playback status unavailable: ${error.message}`,true);}
}
function update(patch){
  settings=normalizeSettings({...settings,...patch});const saved=persist();
  if(Object.keys(patch).some(key=>uiKeys.indexOf(key)===-1))try{engine.update(settings);}catch(error){announce(error.message,true);}
  renderSettings();return saved;
}
for(const key of uiKeys)$(key).addEventListener('change',event=>{
  const value=key==='textScale'?Number(event.target.value):['motionEnabled','visualizer'].indexOf(key)!==-1?event.target.value==='true':event.target.value;
  const saved=update({[key]:value});
  $('uiStatus').textContent=saved?'Display preferences applied and saved on this device.':'Applied for this visit only. Storage is unavailable.';
});
$('resetUI').addEventListener('click',()=>{
  if(!window.confirm('Reset display settings to Paper, comfortable spacing and standard text? Sound settings will stay unchanged.'))return;
  const defaults=normalizeSettings({seed:settings.seed}),patch={};
  for(const key of uiKeys)patch[key]=defaults[key];
  update(patch);$('uiStatus').textContent='Display settings reset. Your sound is unchanged.';
});
$('resetSound').addEventListener('click',()=>{
  if(!window.confirm('Reset sound settings and stop this session? This restores Focus, 25 minutes and default sound levels. Display settings will stay unchanged.'))return;
  try{engine.stop();hasSession=false;state=engine.getState();}catch(error){announce(error.message,true);return;}
  const defaults=normalizeSettings({seed:settings.seed});
  for(const key of uiKeys)defaults[key]=settings[key];
  settings=defaults;persist();renderSettings();announce('Sound settings reset. Start when you are ready.');
});
$('playButton').addEventListener('click',async()=>{
  if(busy)return;busy=true;renderState();
  try{
    if(state.playing){await engine.pause();announce('Paused. Your place is saved.');}
    else{await engine.start(settings);hasSession=true;announce('Playing · generated on this device.');}
    state=engine.getState();if(state.error)throw Error(state.error);
  }catch(error){announce(error.message||'Unable to start audio. Please try again.',true);}
  finally{busy=false;renderState();}
});
$('stopButton').addEventListener('click',()=>{try{engine.stop();state=engine.getState();hasSession=false;announce('Stopped. Ready for a fresh start.');renderState();}catch(error){announce(error.message,true);}});
for(const key of ['duration','ambience','synth'])$(key).addEventListener('change',event=>update({[key]:key==='duration'?Number(event.target.value):event.target.value}));
for(const key of rangeKeys)$(key).addEventListener('input',event=>update({[key]:Number(event.target.value)}));
$('seed').addEventListener('change',event=>{
  const seed=Number(event.target.value);
  if(!Number.isSafeInteger(seed)||seed<1){event.target.value=settings.seed;announce('Use a positive whole-number seed. The current sound seed is unchanged.',true);return;}
  update({seed});
});
document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{const mode=button.dataset.mode;update({mode,...MODE_DEFAULTS[mode]});}));
document.querySelectorAll('[data-style]').forEach(button=>button.addEventListener('click',()=>update({style:button.dataset.style})));
$('newSound').addEventListener('click',async()=>{
  const wasPlaying=state.playing;busy=true;
  try{
    engine.stop();hasSession=false;state=engine.getState();
    settings=normalizeSettings({...settings,seed:Math.floor(Math.random()*2147483646)+1});persist();renderSettings();
    if(wasPlaying){await engine.start(settings);hasSession=true;announce('Playing · a fresh soundscape.');}else announce('A fresh soundscape. Start when you’re ready.');
    state=engine.getState();
  }catch(error){announce(error.message,true);}finally{busy=false;renderState();}
});
const help=$('helpDialog');
help.setAttribute('role','dialog');help.setAttribute('tabindex','-1');
let helpOpener=null,helpBackdrop=null;
function openHelp(){
  if(help.hasAttribute('open'))return;
  helpOpener=document.activeElement;
  document.body.classList.add('help-open');
  if(typeof help.showModal==='function'){
    try{help.showModal();$('closeHelp').focus();return;}catch(error){/* Legacy dialog fallback below. */}
  }
  helpBackdrop=document.createElement('div');helpBackdrop.className='help-backdrop';
  helpBackdrop.addEventListener('click',closeHelp);document.body.appendChild(helpBackdrop);
  help.classList.add('help-fallback');help.setAttribute('open','');$('closeHelp').focus();
}
function closeHelp(){
  if(typeof help.close==='function'&&!help.classList.contains('help-fallback'))help.close();
  else help.removeAttribute('open');
  help.classList.remove('help-fallback');document.body.classList.remove('help-open');
  if(helpBackdrop){helpBackdrop.remove();helpBackdrop=null;}
  if(helpOpener&&typeof helpOpener.focus==='function')helpOpener.focus();
}
$('helpButton').addEventListener('click',openHelp);$('installButton').addEventListener('click',openHelp);
$('closeHelp').addEventListener('click',closeHelp);
help.addEventListener('cancel',event=>{event.preventDefault();closeHelp();});
help.addEventListener('click',event=>{if(event.target===help){const r=help.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeHelp();}});
document.addEventListener('keydown',event=>{
  if(!help.hasAttribute('open'))return;
  if(event.key==='Escape'){event.preventDefault();closeHelp();return;}
  if(event.key!=='Tab')return;
  const targets=Array.from(help.querySelectorAll('button,a,input,select,[tabindex]')).filter(element=>!element.disabled&&element.getClientRects().length&&element.tabIndex>=0);
  const first=targets[0],last=targets[targets.length-1];
  if(!first){event.preventDefault();help.focus();}
  else if(event.shiftKey&&(document.activeElement===first||document.activeElement===help)){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
});
// Fixed mobile transport must not cover a keyboard-focused control. Numeric
// scrollBy is supported in legacy WebViews and never adds motion effects.
document.addEventListener('focusin',event=>{
  const target=event.target;
  if(window.innerWidth>760||help.hasAttribute('open')||!target.getBoundingClientRect||target.closest('.transport'))return;
  requestAnimationFrame(()=>{
    if(document.activeElement!==target)return;
    const bottom=target.getBoundingClientRect().bottom,edge=document.querySelector('.transport').getBoundingClientRect().top;
    if(bottom>edge-12)window.scrollBy(0,bottom-edge+16);
  });
});
document.querySelectorAll('.copy-source').forEach(button=>button.addEventListener('click',async()=>{
  const url=button.parentElement.querySelector('.source-url').textContent.trim();
  let copied=false;
  if(navigator.clipboard&&typeof navigator.clipboard.writeText==='function'){
    try{await navigator.clipboard.writeText(url);copied=true;}catch(error){/* Try the legacy user-gesture copy path. */}
  }
  if(!copied){
    const field=document.createElement('textarea');field.value=url;field.setAttribute('readonly','');field.style.cssText='position:fixed;left:-10000px;top:0';
    document.body.appendChild(field);field.select();
    try{copied=Boolean(document.execCommand('copy'));}catch(error){copied=false;}
    field.remove();button.focus();
  }
  $('copyStatus').textContent=copied?`Source [${button.dataset.source}] URL copied. Open it manually in an external browser.`:'Copy is unavailable. Select the printed URL and copy it manually, or type it into a browser.';
}));
document.querySelector('.desk-link').addEventListener('click',()=>{$('appearance').open=true;});
$('aboutButton').addEventListener('click',()=>{$('about').open=true;$('about').querySelector('summary').focus();});
let installEvent;
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installEvent=event;$('installPrompt').hidden=false;});
$('installPrompt').addEventListener('click',async()=>{if(installEvent){await installEvent.prompt();await installEvent.userChoice;installEvent=null;$('installPrompt').hidden=true;}});
$('exportButton').addEventListener('click',async()=>{
  $('exportButton').disabled=true;$('exportStatus').textContent='Rendering a fresh 30-second preview on your device…';
  try{
    const {renderAudio}=await import('./audio.js');
    const buffer=await renderAudio(settings,30),channels=buffer.numberOfChannels,length=buffer.length;
    const bytes=new ArrayBuffer(44+length*channels*2),view=new DataView(bytes);
    const text=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
    text(0,'RIFF');view.setUint32(4,bytes.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,channels,true);view.setUint32(24,buffer.sampleRate,true);view.setUint32(28,buffer.sampleRate*channels*2,true);view.setUint16(32,channels*2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,bytes.byteLength-44,true);
    const data=Array.from({length:channels},(_,ch)=>buffer.getChannelData(ch));
    for(let i=0;i<length;i++)for(let ch=0;ch<channels;ch++){const sample=Math.max(-1,Math.min(1,data[ch][i]));view.setInt16(44+(i*channels+ch)*2,sample<0?sample*32768:sample*32767,true);}
    const url=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));const link=document.createElement('a');link.href=url;link.download=`stillwave-${settings.mode}-${settings.seed}.wav`;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
    $('exportStatus').textContent='30-second WAV ready. This preview is not a recording of your live session.';
  }catch(error){$('exportStatus').textContent=`Export failed: ${error.message}`;}
  finally{$('exportButton').disabled=false;}
});
if(native){
  $('offlineStatus').textContent='Bundled · ready offline';
  $('offlineDescription').textContent='The app and sound generator are bundled. Even your first launch can be offline.';
  $('offlineButton').disabled=true;$('offlineButton').textContent='Included in app';
  $('exportButton').disabled=true;$('exportButton').title='WAV export is available in the web version, not in this native audio service.';
  $('exportStatus').textContent='Native playback · WAV export unavailable in this build.';
}else{
  setupOffline({button:$('offlineButton'),status:$('offlineStatus')});
}
renderSettings();persist();readState();setInterval(readState,1000);document.addEventListener('visibilitychange',readState);
window.__stillwaveReady=true;
}
bootstrap().catch(error=>{
  const status=document.getElementById('playbackStatus');
  status.textContent=`Unable to initialize Stillwave: ${error.message}`;
  status.classList.add('error');
});
