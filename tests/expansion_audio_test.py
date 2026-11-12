"""Real OfflineAudioContext contracts for expanded procedural DSP (no UI/bundle dependency)."""
import functools
import http.server
import json
import pathlib
import threading
import unittest
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

class ExpandedAudioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(headless=True, args=['--no-sandbox', '--autoplay-policy=no-user-gesture-required'])
    @classmethod
    def tearDownClass(cls):
        cls.browser.close(); cls.pw.stop(); cls.server.shutdown(); cls.server.server_close()
    def setUp(self):
        self.page = self.browser.new_page()
        self.page.goto(f'http://127.0.0.1:{self.server.server_port}/web/js/settings.js')
    def tearDown(self):
        self.page.close()

    def test_styles_synths_and_textures_have_distinct_bounded_audio(self):
        result=self.page.evaluate('''async()=>{
          const {renderAudio}=await import('./audio.js');
          async function family(key,values,extra={}){
            const signals=[],metrics=[];
            for(const value of values){const b=await renderAudio({seed:867,volume:1,brightness:1,space:.7,...extra,[key]:value},6,{sampleRate:24000});
              const data=b.getChannelData(0);let peak=0,power=0;
              for(const x of data){if(!Number.isFinite(x))throw Error('nonfinite '+key+value);peak=Math.max(peak,Math.abs(x));power+=x*x;}
              signals.push(data);metrics.push({value,peak,rms:Math.sqrt(power/data.length)});}
            let minimum=Infinity;
            for(let a=0;a<signals.length;a++)for(let b=a+1;b<signals.length;b++){let d=0;for(let i=0;i<signals[a].length;i++)d+=(signals[a][i]-signals[b][i])**2;minimum=Math.min(minimum,Math.sqrt(d/signals[a].length));}
            return {metrics,minimum};
          }
          return {styles:await family('style',['ambient','lofi','deep','glass','drift','tape']),
            synths:await family('synth',['sine','triangle','fm','organ']),
            textures:await family('ambience',['rain','brown','pink','ocean','wind','fire'],{musicVolume:0,bassVolume:0,melodyVolume:0,ambienceVolume:1})};
        }''')
        print('EXPANDED WEB FAMILIES:',json.dumps(result))
        for family, data in result.items():
            self.assertGreater(data['minimum'],.0001,family)
            for metric in data['metrics']:
                self.assertGreater(metric['rms'],.0002,metric['value'])
                self.assertLess(metric['peak'],.95,metric['value'])

    def test_live_updates_visualization_and_legacy_automation_fallback(self):
        result=self.page.evaluate('''async()=>{
          const {StillwaveEngine,renderAudio}=await import('./audio.js');
          const e=new StillwaveEngine();await e.start({seed:42,stereo:0,duration:0});
          await new Promise(r=>setTimeout(r,500));
          const data=e.getVisualizationData(),Graph=e.graph.constructor;
          const visualization={typed:data instanceof Uint8Array,size:data.length,active:Array.from(data).some(x=>x!==128)};
          e.stop();
          const original=AudioParam.prototype.cancelAndHoldAtTime;AudioParam.prototype.cancelAndHoldAtTime=undefined;
          try{
            const c=new OfflineAudioContext(2,24000*7,24000),g=new Graph(c,{seed:123,stereo:0,synth:'sine',space:0},0);g.schedule(7);
            const suspension=c.suspend(2);const rendering=c.startRendering();await suspension;
            g.update({...g.settings,stereo:1,synth:'fm',style:'tape',brightness:1,space:1,ambience:'wind',density:1});
            await c.resume();const b=await rendering;const l=b.getChannelData(0),r=b.getChannelData(1);
            let before=0,after=0,step=0;for(let i=0;i<l.length;i++){
              if(i<24000*1.9)before=Math.max(before,Math.abs(l[i]-r[i]));
              if(i>24000*4)after=Math.max(after,Math.abs(l[i]-r[i]));
              if(i>0&&i>=24000*1.95&&i<24000*2.5)step=Math.max(step,Math.abs(l[i]-l[i-1]),Math.abs(r[i]-r[i-1]));}
            g.dispose();await renderAudio({seed:42},2,{sampleRate:24000});
            return {visualization,before,after,step};
          }finally{AudioParam.prototype.cancelAndHoldAtTime=original;}
        }''')
        print('EXPANDED WEB LIVE:',json.dumps(result))
        self.assertTrue(result['visualization']['typed'])
        self.assertTrue(result['visualization']['active'])
        self.assertEqual(result['visualization']['size'],256)
        self.assertEqual(result['before'],0)
        self.assertGreater(result['after'],.001)
        self.assertLess(result['step'],.1)

    def test_muting_live_controls_reaches_exact_silence_after_short_fade(self):
        result=self.page.evaluate('''async()=>{
          const {StillwaveEngine}=await import('./audio.js');const e=new StillwaveEngine();await e.start({seed:42});
          const Graph=e.graph.constructor;e.stop();
          async function run(patch){const c=new OfflineAudioContext(2,24000*5,24000),g=new Graph(c,{seed:42,ambience:'none',space:1},0);g.schedule(5);
            const suspended=c.suspend(2),rendering=c.startRendering();await suspended;g.update({...g.settings,...patch});await c.resume();
            const buffer=await rendering;let peak=0;for(let ch=0;ch<2;ch++)for(const x of buffer.getChannelData(ch).slice(24000*4))peak=Math.max(peak,Math.abs(x));g.dispose();return peak;}
          return {volume:await run({volume:0}),layers:await run({musicVolume:0,bassVolume:0,melodyVolume:0,space:1})};
        }''')
        self.assertEqual(result['volume'],0)
        self.assertEqual(result['layers'],0)

    def test_layers_tone_space_stereo_density_change_real_signal(self):
        result = self.page.evaluate('''async()=>{
          const {renderAudio}=await import('./audio.js');
          const base={seed:42,volume:.7,intensity:0,space:0};
          const render=async extra=>await renderAudio({...base,...extra},8,{sampleRate:24000});
          const ref=await render({});
          function stats(b){let power=0,peak=0,side=0;const l=b.getChannelData(0),r=b.getChannelData(1);
            for(let i=0;i<l.length;i++){if(!Number.isFinite(l[i])||!Number.isFinite(r[i]))throw Error('nonfinite');
              power+=l[i]*l[i]+r[i]*r[i];peak=Math.max(peak,Math.abs(l[i]),Math.abs(r[i]));side+=Math.abs(l[i]-r[i]);}
            return {rms:Math.sqrt(power/(2*l.length)),peak,side:side/l.length};}
          function diff(b){let sum=0;for(let ch=0;ch<2;ch++){const a=ref.getChannelData(ch),d=b.getChannelData(ch);for(let i=0;i<a.length;i++)sum+=(a[i]-d[i])**2;}return Math.sqrt(sum/(ref.length*2));}
          const controls={};for(const key of ['musicVolume','bassVolume','melodyVolume','brightness','space','stereo','density'])controls[key]=diff(await render({[key]:key==='space'?1:0}));
          const mono=stats(await render({stereo:0,space:1}));
          const silent=stats(await render({musicVolume:0,bassVolume:0,melodyVolume:0,ambience:'none',space:1}));
          const muted=stats(await render({volume:0,ambience:'fire',ambienceVolume:1}));
          return {reference:stats(ref),controls,mono,silent,muted};
        }''')
        print('EXPANDED WEB MIX:', json.dumps(result))
        for key, difference in result['controls'].items():
            self.assertGreater(difference, 0.00005, key)
        self.assertGreater(result['reference']['rms'], .005)
        self.assertLess(result['reference']['peak'], .9)
        self.assertEqual(result['mono']['side'], 0)
        self.assertEqual(result['silent']['peak'], 0)
        self.assertEqual(result['muted']['peak'], 0)

if __name__ == '__main__':
    unittest.main(verbosity=2)
