import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSettings,loadSettings,saveSettings,STORAGE_KEY} from '../web/js/settings.js';

test('expanded settings preserve old defaults and migrate in the existing storage slot',()=>{
  const s=normalizeSettings({seed:42});
  assert.deepEqual([s.brightness,s.space,s.stereo,s.density,s.musicVolume,s.bassVolume,s.melodyVolume],[.5,.25,.65,.5,.8,.5,.5]);
  assert.deepEqual([s.synth,s.theme,s.uiDensity,s.textScale,s.motionEnabled,s.visualizer],['sine','paper','comfortable',1,true,true]);
  assert.deepEqual([s.volume,s.rateHz,s.intensity,s.ambienceVolume,s.duration],[.55,16,.22,.2,25]);
  let stored=JSON.stringify({seed:42,mode:'sleep',volume:.3});
  const storage={getItem(k){assert.equal(k,STORAGE_KEY);return stored;},setItem(k,v){assert.equal(k,STORAGE_KEY);stored=v;}};
  const migrated=loadSettings(storage);assert.equal(migrated.style,'deep');assert.equal(migrated.volume,.3);assert.equal(migrated.synth,'sine');
  assert.ok(saveSettings({...migrated,synth:'organ',theme:'dusk'},storage));assert.equal(loadSettings(storage).theme,'dusk');
});

test('every supported option survives normalization and unsafe values cannot leak',()=>{
  for(const style of ['ambient','lofi','deep','glass','drift','tape']) assert.equal(normalizeSettings({style}).style,style);
  for(const synth of ['sine','triangle','fm','organ']) assert.equal(normalizeSettings({synth}).synth,synth);
  for(const ambience of ['none','rain','brown','pink','ocean','wind','fire']) assert.equal(normalizeSettings({ambience}).ambience,ambience);
  for(const theme of ['paper','graphite','moss','sand','dusk','night']) assert.equal(normalizeSettings({theme}).theme,theme);
  for(const key of ['brightness','space','stereo','density','musicVolume','bassVolume','melodyVolume']){
    assert.equal(normalizeSettings({[key]:-1})[key],0);assert.equal(normalizeSettings({[key]:2})[key],1);
    assert.equal(normalizeSettings({[key]:NaN})[key],normalizeSettings()[key]);
    assert.equal(normalizeSettings({[key]:true})[key],normalizeSettings()[key]);
  }
  const s=normalizeSettings({synth:'url',theme:'url',uiDensity:'huge',textScale:2,motionEnabled:'false',visualizer:0});
  assert.deepEqual([s.synth,s.theme,s.uiDensity,s.textScale,s.motionEnabled,s.visualizer],['sine','paper','comfortable',1,true,true]);
  assert.equal(normalizeSettings({motionEnabled:false,visualizer:false,textScale:1.15,uiDensity:'compact'}).motionEnabled,false);
});
