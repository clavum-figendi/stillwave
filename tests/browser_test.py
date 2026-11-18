"""Real Chromium integration tests for the web app. Run: python tests/browser_test.py"""
import functools
import http.server
import json
import pathlib
import threading
import unittest
import wave
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
FAKE_NATIVE = '''
  window.nativeCalls=[];window.nativeState={playing:false,elapsed:0};
  window.NativeAudio={
    start(s){window.nativeCalls.push(['start',JSON.parse(s)]);window.nativeState={playing:true,elapsed:72};},
    pause(){window.nativeCalls.push(['pause']);window.nativeState.playing=false;},
    stop(){window.nativeCalls.push(['stop']);window.nativeState={playing:false,elapsed:0};},
    update(s){window.nativeCalls.push(['update',JSON.parse(s)]);},
    getState(){return JSON.stringify(window.nativeState);}
  };
'''


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.endswith('/assets/icon-512.png') and getattr(self.server, 'block_icon', False):
            self.server.saw_blocked_icon.set()
            self.send_error(503, 'Simulated transient install failure')
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
        cls.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}/stillwave/'
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(headless=True, args=['--no-sandbox', '--autoplay-policy=no-user-gesture-required'])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close(); cls.pw.stop(); cls.server.shutdown(); cls.server.server_close()

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=1)
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))

    def tearDown(self):
        self.context.close()

    def open(self):
        self.page.goto(self.url)
        self.page.wait_for_function('window.__stillwaveReady === true')

    def play(self):
        self.page.get_by_role('button', name='Play', exact=True).click()
        self.page.get_by_role('button', name='Pause', exact=True).wait_for()

    def open_settings(self, advanced=True):
        self.page.get_by_role('button', name='Settings', exact=True).click()
        if advanced:
            self.page.locator('#advanced summary').click()

    def test_worklet_engine_plays_composed_music_and_pauses_resumes_stops(self):
        self.open()
        self.play()
        self.page.wait_for_function("document.getElementById('elapsed').textContent !== '00:00'", timeout=5000)
        self.page.get_by_role('button', name='Pause', exact=True).click()
        self.page.get_by_role('button', name='Resume', exact=True).wait_for()
        held = self.page.locator('#elapsed').inner_text()
        self.page.wait_for_timeout(1200)
        self.assertEqual(self.page.locator('#elapsed').inner_text(), held)
        self.page.get_by_role('button', name='Resume', exact=True).click()
        self.page.get_by_role('button', name='Pause', exact=True).wait_for()
        self.page.get_by_role('button', name='Stop', exact=True).click()
        self.assertEqual(self.page.locator('#elapsed').inner_text(), '00:00')
        self.assertEqual(self.errors, [])

    def test_engine_host_renders_audible_notes_in_worklet_and_script_processor(self):
        self.page.goto(self.url + 'js/settings.js')
        result = self.page.evaluate('''async()=>{
          const {StillwaveEngine}=await import('./audio.js');
          const measure=async e=>{e.workletUrl='../worklet.bundle.js';await e.start({seed:7,style:'lofi',duration:0,volume:.6});await new Promise(r=>setTimeout(r,3500));
            let peak=0;for(let i=0;i<20;i++){peak=Math.max(peak,e.getLevel());await new Promise(r=>setTimeout(r,50));}
            const notes=e.getNotes().length,usesWorklet=typeof e.node.port==='object'&&!e.renderer;e.stop();return {peak,notes,usesWorklet};};
          const worklet=await measure(new StillwaveEngine());
          const saved=window.AudioWorkletNode;window.AudioWorkletNode=undefined;
          const fallback=await measure(new StillwaveEngine());window.AudioWorkletNode=saved;
          return {worklet,fallback};
        }''')
        print('HOST:', json.dumps(result))
        self.assertTrue(result['worklet']['usesWorklet']); self.assertFalse(result['fallback']['usesWorklet'])
        for key in ['worklet', 'fallback']:
            self.assertGreater(result[key]['peak'], 0.01, key)
            self.assertGreater(result[key]['notes'], 10, key)

    def test_controls_persist_and_layout_fits_every_width(self):
        self.open()
        self.page.get_by_role('radio', name='Sleep').click()
        self.page.get_by_role('radio', name='Kalimba').click()
        self.page.get_by_role('radio', name='Ocean').click()
        self.page.get_by_role('button', name='Session length').click()
        self.page.get_by_role('radio', name='No limit').click()
        self.page.get_by_role('button', name='Mix', exact=True).click()
        self.page.locator('#beatVolume').fill('0')
        self.page.keyboard.press('Escape')
        self.assertEqual(self.page.locator('#title').inner_text(), 'Kalimba')
        self.assertEqual(self.page.locator('#timerLabel').inner_text(), '∞')
        self.page.reload(); self.page.wait_for_function('window.__stillwaveReady === true')
        stored = self.page.evaluate("JSON.parse(localStorage.getItem('stillwave.settings.v1'))")
        self.assertEqual([stored['mode'], stored['style'], stored['ambience'], stored['duration'], stored['beatVolume']], ['sleep', 'kalimba', 'ocean', 0, 0])
        self.assertEqual(self.page.get_by_role('radio', name='Kalimba').get_attribute('aria-checked'), 'true')
        for width in [360, 390, 768, 1280, 1600]:
            self.page.set_viewport_size({'width': width, 'height': 900})
            self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'Overflow at {width}')
        self.page.set_viewport_size({'width': 390, 'height': 844})
        self.page.screenshot(path=str(ROOT / 'tests' / 'stillwave-mobile.png'))
        self.page.set_viewport_size({'width': 1440, 'height': 900})
        self.page.screenshot(path=str(ROOT / 'tests' / 'stillwave-desktop.png'))

    def test_settings_keep_technical_controls_behind_advanced(self):
        self.open()
        self.open_settings(advanced=False)
        self.assertFalse(self.page.locator('#synth').is_visible())
        self.page.locator('[data-theme-choice="dusk"]').click()
        self.assertEqual(self.page.evaluate("document.documentElement.dataset.theme"), 'dusk')
        self.page.locator('#advanced summary').click()
        self.page.locator('#key').select_option('2'); self.page.locator('#scale').select_option('dorian'); self.page.locator('#synth').select_option('organ')
        self.assertIn('D dorian', self.page.locator('#meta').inner_text())
        self.page.locator('#intensity').fill('0')
        self.assertEqual(self.page.locator('#pulseNote').inner_text(), 'Pulse is off.')
        stored = self.page.evaluate("JSON.parse(localStorage.getItem('stillwave.settings.v1'))")
        self.assertEqual([stored['key'], stored['scale'], stored['synth'], stored['intensity'], stored['theme']], [2, 'dorian', 'organ', 0, 'dusk'])

    def test_v1_preferences_migrate_to_style_instruments_and_system_theme(self):
        self.context.add_init_script("localStorage.setItem('stillwave.settings.v1',JSON.stringify({mode:'sleep',seed:42,volume:.31,duration:45,synth:'sine',theme:'paper'}))")
        self.open()
        stored = self.page.evaluate("JSON.parse(localStorage.getItem('stillwave.settings.v1'))")
        self.assertEqual([stored['synth'], stored['theme'], stored['volume'], stored['duration'], stored['style'], stored['v']], ['auto', 'auto', .31, 45, 'deep', 2])

    def test_native_bridge_owns_audio_and_score_shadows_the_composer(self):
        self.context.add_init_script(FAKE_NATIVE + "window.AudioContext=class{constructor(){throw Error('Browser audio must never be created in native mode');}};")
        self.open()
        self.play()
        self.assertEqual(self.page.locator('#elapsed').inner_text(), '01:12')
        self.page.wait_for_function("document.getElementById('score').dataset.running === 'true'")
        self.page.get_by_role('radio', name='Pulse').click()
        self.page.get_by_role('button', name='Pause', exact=True).click()
        self.page.get_by_role('button', name='Resume', exact=True).click()
        self.page.get_by_role('button', name='Stop', exact=True).click()
        calls = self.page.evaluate('window.nativeCalls')
        self.assertEqual([c[0] for c in calls], ['start', 'update', 'pause', 'start', 'stop'])
        self.assertEqual(calls[1][1]['style'], 'pulse')
        self.assertIn('beatVolume', calls[0][1]); self.assertIn('key', calls[0][1])
        self.open_settings()
        self.assertEqual(self.page.locator('#offlineStatus').inner_text(), 'Built in · works offline')
        self.assertTrue(self.page.locator('#exportButton').is_disabled())
        self.page.keyboard.press('Escape')
        self.page.evaluate("window.nativeState={playing:false,elapsed:0,error:'Audio service unavailable'}")
        self.page.wait_for_timeout(1300)
        self.assertIn('Audio service unavailable', self.page.locator('#status').inner_text())
        self.assertEqual(self.errors, [])

    def test_legacy_native_bootstrap_without_modern_runtime_apis(self):
        self.context.add_init_script(FAKE_NATIVE + '''
          window.globalThis=undefined;
          document.addEventListener('DOMContentLoaded',()=>{window.legacyBoot=window.__stillwaveReady===true;window.globalThis=window;});
          Promise.allSettled=undefined;Array.prototype.at=undefined;String.prototype.replaceAll=undefined;Promise.prototype.finally=undefined;
          window.ResizeObserver=undefined;window.AudioWorkletNode=undefined;
          window.audioConstructions=0;window.AudioContext=window.webkitAudioContext=class{constructor(){window.audioConstructions++;throw Error('Native audio only');}};
        ''')
        requests = []
        self.page.on('request', lambda request: requests.append(request.url))
        self.context.route('**/*', lambda route: route.continue_() if route.request.url.startswith(self.url) else route.abort())
        self.page.goto(self.url)
        self.assertTrue(self.page.evaluate('window.legacyBoot'))
        self.play()
        self.page.get_by_role('button', name='Stop', exact=True).click()
        self.assertEqual(self.page.evaluate('window.audioConstructions'), 0)
        self.assertTrue(any(url.endswith('/app.bundle.js') for url in requests))
        self.assertFalse(any('/js/' in url or url.endswith('/sw.js') for url in requests))
        self.assertEqual(self.errors, [])

    def test_offline_save_verifies_and_reloads_without_network(self):
        self.open()
        self.open_settings()
        self.page.locator('#offlineButton').click()
        self.page.wait_for_function("document.getElementById('offlineStatus').textContent === 'Ready offline'", timeout=15000)
        keys = self.page.evaluate('caches.keys().then(async names=>(await (await caches.open(names[0])).keys()).map(r=>r.url))')
        self.assertTrue(any(k.endswith('/worklet.bundle.js') for k in keys))
        self.assertTrue(any(k.endswith('/fonts/fraunces.woff2') for k in keys))
        self.context.set_offline(True)
        self.page.goto(self.url + '?offline=1'); self.page.wait_for_function('window.__stillwaveReady === true')
        self.play()
        self.page.wait_for_function("document.getElementById('elapsed').textContent !== '00:00'", timeout=5000)
        self.page.get_by_role('button', name='Stop', exact=True).click()
        self.context.set_offline(False)
        self.assertEqual(self.errors, [])

    def test_missing_cache_is_not_reported_ready_and_failed_install_retries(self):
        self.server.block_icon = True; self.server.saw_blocked_icon = threading.Event()
        try:
            self.open()
            self.assertTrue(self.server.saw_blocked_icon.wait(5))
            self.page.wait_for_function('navigator.serviceWorker.getRegistration().then(r=>!r||(!r.installing&&!r.active))')
        finally:
            self.server.block_icon = False
        self.open_settings()
        self.page.locator('#offlineButton').click()
        self.page.wait_for_function("document.getElementById('offlineStatus').textContent === 'Ready offline'", timeout=15000)
        self.page.evaluate("caches.keys().then(async n=>{const c=await caches.open(n[0]);await c.delete(new URL('./js/audio.js',location.href).href);})")
        self.context.set_offline(True)
        self.page.locator('#offlineButton').click()
        self.page.wait_for_function("document.getElementById('offlineStatus').textContent.includes('Not ready offline')")
        self.context.set_offline(False)

    def test_export_is_a_real_stereo_wav(self):
        self.open()
        self.open_settings()
        self.page.locator('#exportLength').select_option('30')
        with self.page.expect_download(timeout=60000) as pending:
            self.page.locator('#exportButton').click()
        output = ROOT / 'tests' / 'stillwave-preview.wav'
        pending.value.save_as(str(output))
        with wave.open(str(output), 'rb') as audio:
            self.assertEqual((audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getnframes()), (2, 2, 44100, 44100 * 30))
            self.assertTrue(any(audio.readframes(44100 * 10)))

    def test_timer_expires_and_closes_audio(self):
        self.page.goto(self.url + 'js/settings.js')
        result = self.page.evaluate('''async()=>{
          const {StillwaveEngine}=await import('./audio.js');const e=new StillwaveEngine();e.workletUrl='../worklet.bundle.js';
          await e.start({seed:1234,duration:15});const context=e.context;e.elapsed=899.8;
          await new Promise(r=>setTimeout(r,900));
          return {state:e.getState(),timer:e.timer,context:context.state};
        }''')
        self.assertEqual(result['state']['elapsed'], 0); self.assertFalse(result['state']['playing'])
        self.assertIsNone(result['timer']); self.assertEqual(result['context'], 'closed')

    def test_accessible_targets_dialogs_keyboard_and_reduced_motion(self):
        self.open()
        for width in [360, 1280]:
            self.page.set_viewport_size({'width': width, 'height': 900})
            small = self.page.evaluate('''()=>Array.from(document.querySelectorAll('main button,footer button,header button')).filter(e=>e.getClientRects().length&&!e.disabled)
              .map(e=>({name:e.getAttribute('aria-label')||e.textContent.trim(),w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height})).filter(t=>t.w<44||t.h<44)''')
            self.assertEqual(small, [])
        self.page.set_viewport_size({'width': 390, 'height': 844})
        self.page.get_by_role('button', name='How it works').click()
        self.assertTrue(self.page.locator('#infoSheet').is_visible())
        self.page.keyboard.press('Escape')
        self.assertFalse(self.page.locator('#infoSheet').is_visible())
        self.page.evaluate('document.activeElement.blur()')
        self.page.keyboard.press('Space')
        self.page.get_by_role('button', name='Pause', exact=True).wait_for()
        self.page.wait_for_function("document.getElementById('score').dataset.running === 'true'")
        self.page.emulate_media(reduced_motion='reduce')
        self.page.wait_for_function("document.getElementById('score').dataset.running === 'false'")
        self.page.get_by_role('button', name='Stop', exact=True).click()


if __name__ == '__main__':
    unittest.main(verbosity=2)
