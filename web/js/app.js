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
function announce(message,error=false){
  if($('playbackStatus').textContent!==message)$('playbackStatus').textContent=message;
  $('playbackStatus').classList.toggle('error',error);
}
function persist(){
  if(!saveSettings(settings))$('storageStatus').textContent='Preferences cannot be saved in this browser. Sound still works.';
}
function renderSettings(){
  for(const key of ['duration','volume','intensity','rateHz','ambience','ambienceVolume']){
    const element=$(key);element.value=settings[key];
    if(element.type==='range')element.style.setProperty('--fill',`${(settings[key]-Number(element.min))/(Number(element.max)-Number(element.min))*100}%`);
  }
  for(const key of ['volume','intensity','ambienceVolume'])$(key+'Value').textContent=`${Math.round(settings[key]*100)}%`;
  $('rateHzValue').textContent=`${settings.rateHz} Hz`;
  document.querySelectorAll('[data-mode]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===settings.mode)));
  document.querySelectorAll('[data-style]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.style===settings.style)));
  $('soundCategory').textContent=`${settings.mode.toUpperCase()} / ${settings.style==='lofi'?'LO-FI':settings.style.toUpperCase()}`;
  [$('soundTitle').textContent,$('soundDescription').textContent]=descriptions[settings.mode];
  $('total').textContent=settings.duration?` / ${formatTime(settings.duration*60)}`:' / ∞';
  $('clockNote').textContent=settings.mode==='focus'&&settings.rateHz===16?'16 pulses per beat on a 60 BPM musical clock.':'Experimental independent modulation: the musical clock is not rate-derived. Depth 0% turns modulation off.';
  renderState();
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
function update(patch){settings=normalizeSettings({...settings,...patch});persist();try{engine.update(settings);}catch(error){announce(error.message,true);}renderSettings();}
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
for(const key of ['duration','ambience'])$(key).addEventListener('change',event=>update({[key]:key==='duration'?Number(event.target.value):event.target.value}));
for(const key of ['volume','intensity','rateHz','ambienceVolume'])$(key).addEventListener('input',event=>update({[key]:Number(event.target.value)}));
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
function openHelp(){if(!help.open)help.showModal();}
$('helpButton').addEventListener('click',openHelp);$('installButton').addEventListener('click',openHelp);
$('closeHelp').addEventListener('click',()=>help.close());
help.addEventListener('click',event=>{if(event.target===help){const r=help.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)help.close();}});
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
