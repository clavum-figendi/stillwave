"""Real Chromium integration tests. Run: python tests/browser_test.py."""
import functools
import http.server
import json
import pathlib
import threading
import unittest
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.endswith('/assets/icon-512.png') and getattr(self.server,'block_icon',False):
            self.server.saw_blocked_icon.set()
            self.send_error(503,'Simulated transient install failure')
            return
        super().do_GET()
    def translate_path(self, path):
        if path.split('?')[0].startswith('/stillwave/'):
            self.path = path.replace('/stillwave/', '/web/', 1)
        return super().translate_path(self.path)
    def log_message(self, *args):
        pass

class BrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(('127.0.0.1',0), functools.partial(Handler,directory=str(ROOT)))
        threading.Thread(target=cls.server.serve_forever,daemon=True).start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}/stillwave/'
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(headless=True,args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])
    @classmethod
    def tearDownClass(cls):
        cls.browser.close(); cls.pw.stop(); cls.server.shutdown(); cls.server.server_close()
    def setUp(self):
        self.context = self.browser.new_context(viewport={'width':390,'height':844},device_scale_factor=1)
        self.page = self.context.new_page()
        # A same-origin fixture lets the audio module be tested before the UI exists.
        self.page.goto(self.url + 'js/settings.js')
    def tearDown(self):
        self.context.close()
    def test_audio_renders_and_modulates_real_samples(self):
        result = self.page.evaluate('''async () => {
          const { renderAudio } = await import('./audio.js');
          const settings = {seed:12345,volume:0.7,ambience:'none',rateHz:16};
          const analyze = buffer => {
            const d=buffer.getChannelData(0), sr=buffer.sampleRate;
            let power=0,peak=0,re=0,im=0,n=0;
            const hop=120;
            for(let i=sr*3;i<d.length;i+=hop){
              let sum=0;
              for(let j=i;j<Math.min(i+hop,d.length);j++) {sum+=d[j]*d[j];peak=Math.max(peak,Math.abs(d[j]));}
              const env=Math.sqrt(sum/hop), t=(i+hop/2)/sr;
              power+=env;re+=env*Math.cos(2*Math.PI*16*t);im+=env*Math.sin(2*Math.PI*16*t);n++;
            }
            return {mean:power/n,peak,mod:power?2*Math.hypot(re,im)/power:0};
          };
          const off=analyze(await renderAudio({...settings,intensity:0},12,{sampleRate:24000}));
          const on=analyze(await renderAudio({...settings,intensity:0.6},12,{sampleRate:24000}));
          const silent=analyze(await renderAudio({...settings,volume:0},5,{sampleRate:24000}));
          return {off,on,silent};
        }''')
        print('RENDERED AUDIO:',json.dumps(result))
        self.assertGreater(result['off']['mean'],0.005)
        self.assertLess(result['on']['peak'],0.95)
        self.assertGreater(result['on']['mod'],result['off']['mod']*5)
        self.assertGreater(result['on']['mod'],0.12)
        self.assertEqual(result['silent']['peak'],0)

    def test_engine_pause_resume_stop_and_external_suspension(self):
        result = self.page.evaluate('''async () => {
          const {StillwaveEngine}=await import('./audio.js');
          const engine=new StillwaveEngine();
          const settings={seed:42,volume:.3,duration:0};
          await engine.start(settings);
          await new Promise(r=>setTimeout(r,180));
          const active=engine.getState();await engine.pause();
          const paused=engine.getState(), pausedGain=engine.graph.master.gain.value;await new Promise(r=>setTimeout(r,180));
          const held=engine.getState();await engine.start(settings);
          await new Promise(r=>setTimeout(r,150));const resumed=engine.getState();
          await engine.context.suspend();const interrupted=engine.getState();
          await engine.start(settings);const recovered=engine.getState();
          engine.stop();const stopped=engine.getState();
          await new Promise(r=>setTimeout(r,300));
          return {active,paused,pausedGain,held,resumed,interrupted,recovered,stopped,timer:engine.timer};
        }''')
        self.assertTrue(result['active']['playing'])
        self.assertFalse(result['paused']['playing'])
        self.assertLess(result['pausedGain'],0.0001)
        self.assertAlmostEqual(result['paused']['elapsed'],result['held']['elapsed'],places=3)
        self.assertGreater(result['resumed']['elapsed'],result['held']['elapsed'])
        self.assertFalse(result['interrupted']['playing'])
        self.assertTrue(result['recovered']['playing'])
        self.assertFalse(result['stopped']['playing'])
        self.assertEqual(result['stopped']['elapsed'],0)
        self.assertIsNone(result['timer'])

    def test_player_controls_persistence_and_mobile_layout(self):
        self.page.goto(self.url)
        self.page.get_by_role('button',name='Start session',exact=True).wait_for()
        self.assertEqual(self.page.title(),'Stillwave — sound for your state of mind')
        self.page.get_by_role('button',name='Sleep',exact=False).click()
        self.assertEqual(self.page.locator('#rateHz').input_value(),'1')
        self.page.locator('#duration').select_option('0')
        self.page.locator('#intensity').fill('0')
        self.page.locator('#intensity').dispatch_event('input')
        self.page.get_by_role('button',name='Start session',exact=True).click()
        self.page.get_by_role('button',name='Pause session',exact=True).wait_for()
        self.page.wait_for_timeout(1200)
        self.page.get_by_role('button',name='Pause session',exact=True).click()
        self.page.get_by_role('button',name='Resume session',exact=True).wait_for()
        timer=self.page.locator('#elapsed').inner_text()
        self.page.wait_for_timeout(1200)
        self.assertEqual(self.page.locator('#elapsed').inner_text(),timer)
        self.page.get_by_role('button',name='Resume session',exact=True).click()
        self.page.get_by_role('button',name='Pause session',exact=True).wait_for()
        self.page.get_by_role('button',name='Stop session',exact=True).click()
        self.assertEqual(self.page.locator('#elapsed').inner_text(),'00:00')
        self.page.reload()
        self.assertEqual(self.page.locator('#duration').input_value(),'0')
        self.assertEqual(self.page.locator('#intensity').input_value(),'0')
        self.assertEqual(self.page.locator('[data-mode="sleep"]').get_attribute('aria-pressed'),'true')
        for width in [360,390,1280]:
            self.page.set_viewport_size({'width':width,'height':900})
            self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= innerWidth'),f'Overflow at {width}')
        self.page.set_viewport_size({'width':390,'height':844})
        self.page.screenshot(path=str(ROOT/'tests'/'stillwave-mobile.png'),full_page=True)
        self.page.set_viewport_size({'width':1440,'height':1000})
        self.page.screenshot(path=str(ROOT/'tests'/'stillwave-desktop.png'),full_page=True)

    def test_native_bridge_owns_audio_and_reports_service_timer(self):
        self.context.add_init_script('''
          window.nativeCalls=[];window.nativeState={playing:false,elapsed:0};
          window.NativeAudio={
            start(s){window.nativeCalls.push(['start',JSON.parse(s)]);window.nativeState={playing:true,elapsed:72};},
            pause(){window.nativeCalls.push(['pause']);window.nativeState.playing=false;},
            stop(){window.nativeCalls.push(['stop']);window.nativeState={playing:false,elapsed:0};},
            update(s){window.nativeCalls.push(['update',JSON.parse(s)]);},
            getState(){return JSON.stringify(window.nativeState);}
          };
          window.AudioContext=class {constructor(){throw Error('Browser audio must never be created in native mode');}};
        ''')
        self.page.goto(self.url)
        self.page.get_by_role('button',name='Start session',exact=True).click()
        self.page.get_by_role('button',name='Pause session',exact=True).wait_for()
        self.assertEqual(self.page.locator('#elapsed').inner_text(),'01:12')
        self.page.locator('#volume').fill('0.4')
        self.page.get_by_role('button',name='Pause session',exact=True).click()
        self.page.get_by_role('button',name='Resume session',exact=True).wait_for()
        self.page.get_by_role('button',name='Resume session',exact=True).click()
        self.page.get_by_role('button',name='Stop session',exact=True).click()
        calls=self.page.evaluate('window.nativeCalls')
        self.assertEqual([x[0] for x in calls],['start','update','pause','start','stop'])
        self.assertIn('duration',calls[0][1]);self.assertNotIn('durationMinutes',calls[0][1])
        self.assertEqual(self.page.locator('#offlineStatus').inner_text(),'Bundled · ready offline')
        self.assertTrue(self.page.locator('#exportButton').is_disabled())
        self.assertEqual(self.page.evaluate('navigator.serviceWorker.getRegistrations().then(x=>x.length)'),0)
        self.page.evaluate("window.nativeState={playing:false,elapsed:0,error:'Audio service unavailable'}")
        self.page.wait_for_timeout(1200)
        self.assertIn('Audio service unavailable',self.page.locator('#playbackStatus').inner_text())

    def test_pwa_verifies_precache_and_reloads_without_network(self):
        errors=[]
        self.page.on('pageerror',lambda error:errors.append(str(error)))
        self.page.goto(self.url)
        self.page.get_by_role('button',name='Save offline',exact=True).click()
        self.page.wait_for_function("document.getElementById('offlineStatus').textContent.includes('Ready offline')",timeout=10000)
        report=self.page.evaluate('''async()=>{
          const registration=await navigator.serviceWorker.ready;
          const channel=new MessageChannel();
          return await new Promise(resolve=>{channel.port1.onmessage=e=>resolve(e.data);registration.active.postMessage({type:'CHECK_OFFLINE'},[channel.port2]);});
        }''')
        self.assertTrue(report['ready']);self.assertEqual(report['missing'],[])
        self.assertGreaterEqual(report['total'],12)
        keys=self.page.evaluate('caches.keys().then(async names=>(await (await caches.open(names[0])).keys()).map(r=>r.url))')
        self.assertTrue(all('/stillwave/' in key for key in keys))
        self.assertTrue(any(key.endswith('/js/audio.js') for key in keys))
        self.context.set_offline(True)
        self.page.goto(self.url+'?offline-check=1')
        self.page.get_by_role('button',name='Start session',exact=True).click()
        self.page.get_by_role('button',name='Pause session',exact=True).wait_for()
        self.page.get_by_role('button',name='Stop session',exact=True).click()
        self.page.get_by_role('button',name='Check offline',exact=True).click()
        self.page.wait_for_function("document.getElementById('offlineStatus').textContent.includes('Ready offline')")
        self.assertEqual(errors,[])
        self.context.set_offline(False)

    def test_legacy_native_bootstrap_without_modern_runtime_apis(self):
        errors=[]
        self.page.on('pageerror',lambda error:errors.append(str(error)))
        self.context.add_init_script('''
          window.globalThis=undefined;
          // Playwright itself needs globalThis after navigation. Restore only
          // after the deferred app script has booted without it.
          document.addEventListener('DOMContentLoaded',()=>{
            window.legacyBootWithoutGlobalThis=window.__stillwaveReady===true;
            window.globalThis=window;
          });
          Promise.allSettled=undefined;Array.prototype.at=undefined;
          String.prototype.replaceAll=undefined;
          window.audioConstructions=0;
          window.AudioContext=window.webkitAudioContext=class {
            constructor(){window.audioConstructions++;throw Error('Native audio only');}
          };
          window.nativeState={playing:false,elapsed:0};window.nativeCalls=[];
          window.NativeAudio={
            getState(){return JSON.stringify(window.nativeState);},
            start(s){window.nativeCalls.push(['start',JSON.parse(s)]);window.nativeState={playing:true,elapsed:64};},
            pause(){window.nativeCalls.push(['pause']);window.nativeState.playing=false;},
            stop(){window.nativeCalls.push(['stop']);window.nativeState={playing:false,elapsed:0};},
            update(s){window.nativeCalls.push(['update',JSON.parse(s)]);}
          };
          localStorage.setItem('stillwave.settings.v1',JSON.stringify({mode:'sleep',seed:42,volume:.31,duration:45}));
        ''')
        # An APK serves packaged files at its local origin. Permit only the
        # local fixture; no CDN, npm dependency or source module may be fetched.
        requests=[]
        self.page.on('request',lambda request:requests.append(request.url))
        self.context.route('**/*',lambda route:route.continue_() if route.request.url.startswith(self.url) else route.abort())
        self.page.goto(self.url)
        self.assertTrue(self.page.evaluate('window.legacyBootWithoutGlobalThis'),'App did not initialize before the compatibility test restored globalThis')
        self.assertEqual(self.page.locator('#volume').input_value(),'0.31')
        self.assertEqual(self.page.locator('#duration').input_value(),'45')
        self.page.get_by_role('button',name='Start session',exact=True).click()
        self.page.get_by_role('button',name='Pause session',exact=True).wait_for()
        self.assertEqual(self.page.locator('#elapsed').inner_text(),'01:04')
        self.page.get_by_role('button',name='Pause session',exact=True).click()
        self.page.get_by_role('button',name='Resume session',exact=True).wait_for()
        self.page.get_by_role('button',name='Resume session',exact=True).click()
        self.page.get_by_role('button',name='Stop session',exact=True).click()
        self.assertEqual(self.page.evaluate('window.nativeCalls.map(x=>x[0])'),['start','pause','start','stop'])
        self.assertEqual(self.page.evaluate('window.audioConstructions'),0)
        self.assertTrue(any(url.endswith('/app.bundle.js') for url in requests))
        self.assertFalse(any('/js/' in url or url.endswith('/sw.js') for url in requests))
        self.assertEqual(errors,[])

    def test_legacy_css_fallbacks_keep_controls_spaced_and_help_scrollable(self):
        import re
        css=(ROOT/'web'/'styles.css').read_text()
        # Strip features missing from factory Chrome 61/74, preserving their
        # prefixed/fixed-unit fallbacks. This is not a substitute for device QA.
        css=re.sub(r'(?<![\w-])gap\s*:[^;}]+;?', '', css)
        css=re.sub(r'font-size:clamp\([^;]+;', '', css)
        css=re.sub(r'max-height:[^;}]*dvh[^;}]*;?', '', css)
        css=re.sub(r'(?<![\w-])appearance:none;?', '', css)
        self.context.route('**/styles.css',lambda route:route.fulfill(status=200,content_type='text/css',body=css))
        self.context.add_init_script('''
          const original=Object.getOwnPropertyDescriptor(Element.prototype,'scrollHeight');
          Object.defineProperty(Element.prototype,'scrollHeight',{configurable:true,get(){
            return this.id==='flexGapProbe'?2:original.get.call(this);
          }});
        ''')
        self.page.goto(self.url)
        self.page.get_by_role('button',name='Start session',exact=True).wait_for()
        self.assertTrue(self.page.evaluate("document.documentElement.classList.contains('no-flex-gap')"))
        self.assertEqual(self.page.locator('h1').evaluate('e=>getComputedStyle(e).fontSize'),'38px')
        self.assertEqual(self.page.locator('#volume').evaluate('e=>getComputedStyle(e).webkitAppearance'),'none')
        gap=self.page.evaluate("document.getElementById('stopButton').getBoundingClientRect().left-document.getElementById('playButton').getBoundingClientRect().right")
        self.assertAlmostEqual(gap,10,places=1)
        for width in [360,390,1280]:
            self.page.set_viewport_size({'width':width,'height':640})
            self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= innerWidth'),f'Legacy overflow at {width}')
        self.page.set_viewport_size({'width':390,'height':640})
        self.page.get_by_role('button',name='Help and installation',exact=True).click()
        height=self.page.locator('#helpDialog').evaluate('e=>e.getBoundingClientRect().height')
        self.assertLessEqual(height,600)
        self.page.locator('#closeHelp').click()

    def test_clock_note_distinguishes_grid_default_from_experimental_rates(self):
        self.page.goto(self.url)
        self.page.get_by_role('button',name='Start session',exact=True).wait_for()
        self.assertIn('60 BPM',self.page.locator('#clockNote').inner_text())
        self.assertNotIn('Experimental',self.page.locator('#clockNote').inner_text())
        self.page.locator('#rateHz').fill('12')
        self.page.locator('#rateHz').dispatch_event('input')
        self.assertIn('Experimental independent modulation',self.page.locator('#clockNote').inner_text())
        self.assertIn('not rate-derived',self.page.locator('#clockNote').inner_text())
        for mode in ['Relax','Sleep','Meditate']:
            self.page.get_by_role('button',name=mode,exact=False).click()
            self.assertIn('Experimental independent modulation',self.page.locator('#clockNote').inner_text())
        self.page.get_by_role('button',name='Focus',exact=False).click()
        self.assertIn('16 pulses per beat',self.page.locator('#clockNote').inner_text())
        self.assertIn('experimental independent modulation',self.page.locator('#about').text_content())

    def test_native_existing_playback_has_truthful_status(self):
        self.context.add_init_script('''window.NativeAudio={getState:()=>JSON.stringify({playing:true,elapsed:120}),start(){},pause(){},stop(){},update(){}};''')
        self.page.goto(self.url)
        self.page.get_by_role('button',name='Pause session',exact=True).wait_for()
        self.assertIn('Playing',self.page.locator('#playbackStatus').inner_text())

    def test_accessible_targets_help_and_reduced_motion(self):
        self.page.goto(self.url)
        self.page.get_by_role('button',name='Start session',exact=True).wait_for()
        for width in [360,1280]:
            self.page.set_viewport_size({'width':width,'height':900})
            targets=self.page.evaluate('''()=>Array.from(document.querySelectorAll('button,a,summary,input,select')).filter(e=>e.getClientRects().length&&!e.disabled).map(e=>({name:e.getAttribute('aria-label')||e.textContent.trim()||e.id,w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height})).filter(e=>e.w<44||e.h<44)''')
            self.assertEqual(targets,[])
        self.page.get_by_role('button',name='Help and installation',exact=True).click()
        self.assertTrue(self.page.get_by_role('dialog').is_visible())
        self.page.keyboard.press('Escape')
        self.assertFalse(self.page.get_by_role('dialog').is_visible())
        self.page.emulate_media(reduced_motion='reduce')
        self.assertEqual(self.page.locator('.orb-lines').evaluate('e=>getComputedStyle(e).animationName'),'none')

    def test_focus_clock_is_grid_aligned(self):
        result=self.page.evaluate('''async()=>{
          const {StillwaveEngine}=await import('./audio.js');const e=new StillwaveEngine();
          await e.start({mode:'focus',seed:1234,duration:0});
          const beats=e.graph.nextChord-e.graph.origin,pulses=(e.graph.nextNote-e.graph.origin)*16;
          e.stop();return {beats,pulses};
        }''')
        self.assertAlmostEqual(result['beats'],round(result['beats']),places=5)
        self.assertAlmostEqual(result['pulses'],round(result['pulses']),places=5)

    def test_export_download_is_a_real_stereo_wav(self):
        import wave
        self.page.goto(self.url)
        with self.page.expect_download() as pending:
            self.page.locator('#exportButton').click()
        download=pending.value
        output=ROOT/'tests'/'stillwave-preview.wav'
        download.save_as(str(output))
        with wave.open(str(output),'rb') as audio:
            self.assertEqual(audio.getnchannels(),2)
            self.assertEqual(audio.getsampwidth(),2)
            self.assertEqual(audio.getframerate(),44100)
            self.assertEqual(audio.getnframes(),44100*30)
            data=audio.readframes(audio.getnframes())
            self.assertTrue(any(data))
        print('EXPORTED WAV:',output,output.stat().st_size,'bytes')

    def test_timer_expires_and_disposes_nodes(self):
        result=self.page.evaluate('''async()=>{
          const {StillwaveEngine}=await import('./audio.js');const e=new StillwaveEngine();
          await e.start({seed:1234,duration:15});const context=e.context,graph=e.graph;
          e.elapsed=899.7;
          await new Promise(r=>setTimeout(r,800));
          return {state:e.getState(),timer:e.timer,nodes:graph.nodes.size,context:context.state};
        }''')
        self.assertEqual(result['state']['elapsed'],0)
        self.assertFalse(result['state']['playing'])
        self.assertIsNone(result['timer'])
        self.assertEqual(result['nodes'],0)
        self.assertEqual(result['context'],'closed')

    def test_missing_cache_is_not_reported_as_ready(self):
        self.page.goto(self.url)
        self.page.locator('#offlineButton').click()
        self.page.wait_for_function("document.getElementById('offlineStatus').textContent.includes('Ready offline')")
        self.page.evaluate('''async()=>{for(const name of await caches.keys()){const c=await caches.open(name);await c.delete(new URL('./js/audio.js',location.href).href);}}''')
        self.context.set_offline(True)
        self.page.locator('#offlineButton').click()
        self.page.wait_for_function("document.getElementById('offlineStatus').textContent.includes('Not ready offline')")
        self.context.set_offline(False)
        self.page.locator('#offlineButton').click()
        self.page.wait_for_function("document.getElementById('offlineStatus').textContent.includes('Ready offline')")

    def test_failed_first_install_can_retry(self):
        self.server.block_icon=True;self.server.saw_blocked_icon=threading.Event()
        try:
            self.page.goto(self.url)
            self.assertTrue(self.server.saw_blocked_icon.wait(5),'Test fixture did not block installation')
            self.page.wait_for_function('navigator.serviceWorker.getRegistration().then(r=>!r||(!r.installing&&!r.active))')
            self.assertNotIn('Ready offline',self.page.locator('#offlineStatus').inner_text())
        finally:
            self.server.block_icon=False
        self.page.locator('#offlineButton').click()
        self.page.wait_for_function("document.getElementById('offlineStatus').textContent.includes('Ready offline')",timeout=10000)

    def test_engine_partial_updates_preserve_the_session(self):
        result=self.page.evaluate('''async()=>{
          const {StillwaveEngine}=await import('./audio.js');const e=new StillwaveEngine();
          await e.start({mode:'sleep',seed:1234,duration:45});
          e.update({volume:.2,intensity:0});const settings=e.settings;e.stop();return settings;
        }''')
        self.assertEqual(result['mode'],'sleep')
        self.assertEqual(result['seed'],1234)
        self.assertEqual(result['duration'],45)
        self.assertEqual(result['intensity'],0)
        self.assertEqual(result['volume'],.2)

if __name__ == '__main__':
    unittest.main(verbosity=2)
