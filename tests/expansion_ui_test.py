"""Expanded instrument UI: real Chromium, local HTTP, no external services.
Run: python tests/expansion_ui_test.py (after cd tests && npm run build).
"""
import functools
import http.server
import json
import pathlib
import threading
import unittest
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

class ExpansionUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT/'web')))
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}/'
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(headless=True, args=['--no-sandbox','--autoplay-policy=no-user-gesture-required'])

    @classmethod
    def tearDownClass(cls):
        cls.browser.close(); cls.pw.stop(); cls.server.shutdown(); cls.server.server_close()

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width':390,'height':844})
        self.page = self.context.new_page()
        self.page.set_default_timeout(4000)
        self.errors = []
        self.page.on('pageerror', lambda error:self.errors.append(str(error)))

    def tearDown(self):
        self.assertEqual(self.errors, [])
        self.context.close()

    def open(self):
        self.page.goto(self.url)
        self.page.wait_for_function('window.__stillwaveReady === true')

    def rect(self, selector):
        return self.page.locator(selector).evaluate('e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}}')

    def saved(self):
        return self.page.evaluate("JSON.parse(localStorage.getItem('stillwave.settings.v1'))")

    def test_palette_applies_and_persists(self):
        self.open()
        self.assertEqual(self.page.locator('#theme').count(), 1, 'Palette selector is missing')
        self.page.locator('#appearance').evaluate('e=>e.open=true')
        for theme in ['paper','graphite','moss','sand','dusk','night']:
            self.page.locator('#theme').select_option(theme)
            self.assertEqual(self.page.locator('html').get_attribute('data-theme'), theme)
            self.assertEqual(self.saved()['theme'], theme)
        self.page.reload()
        self.assertEqual(self.page.locator('#theme').input_value(), 'night')
        self.assertEqual(self.page.locator('html').get_attribute('data-theme'), 'night')

    def test_expanded_sound_controls_round_trip(self):
        self.open()
        for key, value in {'synth':'fm','brightness':'0.73','space':'0.41','stereo':'0.82','density':'0.35','musicVolume':'0.62','bassVolume':'0.27','melodyVolume':'0.44','seed':'12345'}.items():
            self.assertEqual(self.page.locator('#'+key).count(), 1, f'Missing {key} control')
            control=self.page.locator('#'+key)
            control.evaluate("e=>{const d=e.closest('details');if(d)d.open=true;}")
            if key == 'synth':
                control.select_option(value)
            else:
                control.fill(value)
                control.dispatch_event('input' if key != 'seed' else 'change')
            expected=value if key=='synth' else float(value)
            self.assertEqual(self.saved()[key], expected)
        for style in ['ambient','lofi','deep','glass','drift','tape']:
            self.assertEqual(self.page.locator(f'[data-style="{style}"]').count(), 1)
            self.page.locator(f'[data-style="{style}"]').click()
            self.assertEqual(self.saved()['style'], style)
        for texture in ['none','rain','brown','pink','ocean','wind','fire']:
            self.page.locator('#ambience').select_option(texture)
            self.assertEqual(self.saved()['ambience'], texture)
        self.page.reload()
        self.assertEqual(self.page.locator('#seed').input_value(), '12345')
        self.assertEqual(self.page.locator('#synth').input_value(), 'fm')
        self.assertEqual(self.page.locator('#space').input_value(), '0.41')
        self.assertEqual(self.page.locator('#duration').input_value(), '25')

    def test_display_preferences_and_independent_confirmed_resets(self):
        self.open()
        self.page.locator('#appearance').evaluate('e=>e.open=true')
        for key,value in {'uiDensity':'compact','textScale':'1.3','motionEnabled':'false','visualizer':'false'}.items():
            self.page.locator('#'+key).select_option(value)
            expected = float(value) if key=='textScale' else value=='true' if key in ['motionEnabled','visualizer'] else value
            self.assertEqual(self.saved()[key], expected, key)
        self.assertEqual(self.page.locator('html').get_attribute('data-density'), 'compact')
        self.assertEqual(self.page.locator('html').get_attribute('data-motion'), 'off')
        self.assertFalse(self.page.locator('#signalDisplay').is_visible())
        self.page.locator('#volume').fill('0.31')
        self.page.locator('#seedControls').evaluate('e=>e.open=true')
        self.page.once('dialog', lambda dialog:dialog.dismiss())
        self.page.locator('#resetSound').click()
        self.assertEqual(self.saved()['volume'], .31)
        self.page.once('dialog', lambda dialog:dialog.accept())
        self.page.locator('#resetSound').click()
        self.assertEqual(self.saved()['volume'], .55)
        self.assertEqual(self.saved()['textScale'], 1.3)
        self.page.locator('#volume').fill('0.41')
        self.page.once('dialog', lambda dialog:dialog.accept())
        self.page.locator('#resetUI').click()
        self.assertEqual(self.saved()['theme'], 'paper')
        self.assertEqual(self.saved()['textScale'], 1)
        self.assertTrue(self.saved()['visualizer'])
        self.assertEqual(self.saved()['volume'], .41)

    def test_measured_display_parks_and_respects_motion(self):
        self.open()
        self.assertEqual(self.page.locator('#signalCanvas').get_attribute('data-running'), 'false')
        self.page.get_by_role('button',name='Start session',exact=True).click()
        self.page.get_by_role('button',name='Pause session',exact=True).wait_for()
        self.page.wait_for_timeout(400)
        self.assertEqual(self.page.locator('#signalCanvas').get_attribute('data-source'), 'measured')
        self.assertEqual(self.page.locator('#signalCanvas').get_attribute('data-running'), 'true')
        active=self.page.locator('#signalCanvas').evaluate('e=>e.toDataURL()')
        self.page.wait_for_timeout(200)
        self.assertNotEqual(self.page.locator('#signalCanvas').evaluate('e=>e.toDataURL()'), active)
        self.page.get_by_role('button',name='Pause session',exact=True).click()
        self.page.get_by_role('button',name='Resume session',exact=True).wait_for()
        self.assertEqual(self.page.locator('#signalCanvas').get_attribute('data-running'), 'false')
        held=self.page.locator('#signalCanvas').evaluate('e=>e.toDataURL()')
        self.page.wait_for_timeout(1100)
        self.assertEqual(self.page.locator('#signalCanvas').evaluate('e=>e.toDataURL()'), held)
        self.page.emulate_media(reduced_motion='reduce')
        self.page.get_by_role('button',name='Resume session',exact=True).click()
        self.assertEqual(self.page.locator('#signalCanvas').get_attribute('data-running'), 'false')
        self.page.emulate_media(reduced_motion='no-preference')
        self.page.wait_for_timeout(100)
        self.assertEqual(self.page.locator('#signalCanvas').get_attribute('data-running'), 'true')
        self.page.locator('#appearance').evaluate('e=>e.open=true')
        self.page.locator('#motionEnabled').select_option('false')
        self.assertEqual(self.page.locator('#signalCanvas').get_attribute('data-running'), 'false')
        self.page.get_by_role('button',name='Stop session',exact=True).click()

    def test_native_sketch_and_legacy_help_fallback(self):
        self.context.add_init_script('''
          window.nativeState={playing:false,elapsed:0};window.nativeCalls=[];
          window.NativeAudio={getState:()=>JSON.stringify(window.nativeState),
            start(s){window.nativeCalls.push(JSON.parse(s));window.nativeState={playing:true,elapsed:12};},
            pause(){window.nativeState.playing=false;},stop(){window.nativeState={playing:false,elapsed:0};},update(){}};
          window.AudioContext=class{constructor(){throw Error('Do not construct web audio in native mode');}};
          HTMLDialogElement.prototype.showModal=undefined;HTMLDialogElement.prototype.close=undefined;
        ''')
        self.open()
        self.assertIn('not output measurement', self.page.locator('#signalLabel').inner_text())
        self.assertEqual(self.page.locator('#signalCanvas').get_attribute('data-source'), 'illustrative')
        self.page.get_by_role('button',name='Help and installation',exact=True).click()
        self.assertTrue(self.page.locator('#helpDialog').is_visible())
        self.assertEqual(self.page.locator('#helpDialog').get_attribute('role'), 'dialog')
        self.page.keyboard.press('Escape')
        self.assertFalse(self.page.locator('#helpDialog').is_visible())
        self.page.get_by_role('button',name='Start session',exact=True).click()
        self.page.get_by_role('button',name='Pause session',exact=True).wait_for()
        self.assertIn('not output measurement', self.page.locator('#signalLabel').inner_text())
        self.assertEqual(self.page.locator('#elapsed').inner_text(), '00:12')
        self.page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))")
        self.assertEqual(self.page.locator('#signalCanvas').get_attribute('data-running'), 'false')
        self.page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'))")
        self.assertEqual(self.page.locator('#signalCanvas').get_attribute('data-running'), 'true')

    def test_research_sources_copy_and_offline_coverage(self):
        self.context.grant_permissions(['clipboard-read','clipboard-write'],origin=self.url)
        self.open()
        self.page.locator('#about').evaluate('e=>e.open=true')
        sources=self.page.locator('.source-list a').evaluate_all('items=>items.map(e=>e.href)')
        self.assertEqual(sources, [
            'https://pmc.ncbi.nlm.nih.gov/articles/PMC11499863',
            'https://www.who.int/news-room/questions-and-answers/item/deafness-and-hearing-loss-safe-listening',
            'https://github.com/adam13331/OpenFM',
            'https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API',
            'https://pmc.ncbi.nlm.nih.gov/articles/PMC13076772',
            'https://pmc.ncbi.nlm.nih.gov/articles/PMC12420781',
            'https://github.com/petrbrzek/focusmusic'])
        self.page.get_by_role('button',name='Copy URL [5]',exact=True).click()
        self.page.wait_for_timeout(150)
        self.assertEqual(self.page.evaluate('navigator.clipboard.readText()'), sources[4])
        text=self.page.locator('#about').inner_text()
        for phrase in ['unexercised equity options','not a reproduction','not validated brain states','not affiliated','safe decibels']:
            self.assertIn(phrase,text)
        self.page.locator('#offlineButton').click()
        self.page.wait_for_function("document.getElementById('offlineStatus').textContent.includes('Ready offline')")
        urls=self.page.evaluate('''async()=>{const all=[];for(const name of await caches.keys()){const cache=await caches.open(name);for(const request of await cache.keys())all.push(new URL(request.url).pathname);}return all;}''')
        local_files=[str(p.relative_to(ROOT/'web')) for p in (ROOT/'web').rglob('*') if p.is_file()]
        self.assertEqual(sorted('/'+path for path in local_files), sorted(set(urls)-{'/'}))
        self.context.set_offline(True)
        self.page.reload()
        self.page.wait_for_function('window.__stillwaveReady === true')
        self.assertIn('competing interests', self.page.locator('#about').text_content() or '')
        self.assertIn('What the research',self.page.evaluate("fetch('./RESEARCH.md').then(r=>r.text())"))
        self.context.set_offline(False)

    def test_ergonomics_palettes_and_responsive_text(self):
        self.open()
        self.page.evaluate("document.querySelectorAll('main details').forEach(e=>e.open=true)")
        for scale in ['1','1.3']:
            self.page.locator('#textScale').select_option(scale)
            for width in [320,360,390,768,1280]:
                self.page.set_viewport_size({'width':width,'height':844})
                self.assertTrue(self.page.evaluate('document.documentElement.scrollWidth<=innerWidth'), f'Overflow at {width} / {scale}')
                targets=self.page.evaluate('''()=>Array.from(document.querySelectorAll('button,a,summary,input,select')).filter(e=>e.getClientRects().length&&!e.disabled).map(e=>({name:e.getAttribute('aria-label')||e.id||e.textContent.trim(),w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height})).filter(e=>e.w<43.9||e.h<43.9)''')
                self.assertEqual(targets, [], f'Small targets at {width} / {scale}')
                if width<=760:
                    self.assertGreaterEqual(self.rect('#theme')['width'],width-42,'Palette names should be readable without a clipped half-width selector')
                    self.page.evaluate('window.scrollTo(0,document.body.scrollHeight)')
                    rect=self.rect('#playButton')
                    self.assertIsNotNone(rect)
                    self.assertLess(rect['y']+rect['height'],845)
                    self.assertGreater(rect['y'],0)
                    footer=self.rect('.site-footer')
                    self.assertLess(footer['y']+footer['height'],self.rect('.transport')['y'])
        self.page.set_viewport_size({'width':1280,'height':900})
        colors=[]
        def luminance(color):
            rgb=[int(color[i:i+2],16)/255 for i in [1,3,5]]
            linear=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in rgb]
            return sum(a*b for a,b in zip(linear,[.2126,.7152,.0722]))
        def contrast(a,b):
            x,y=sorted([luminance(a),luminance(b)])
            return (y+.05)/(x+.05)
        for theme in ['paper','graphite','moss','sand','dusk','night']:
            self.page.locator('#theme').select_option(theme)
            tokens=self.page.evaluate("()=>{const s=getComputedStyle(document.documentElement),o={};for(const k of ['paper','surface','ink','muted','accent','accent-ink'])o[k]=s.getPropertyValue('--'+k).trim();return o;}")
            colors.append(tokens['paper'])
            for text,bg in [('ink','paper'),('muted','paper'),('muted','surface'),('accent','surface'),('accent-ink','accent')]:
                self.assertGreaterEqual(contrast(tokens[text],tokens[bg]),4.5,f'{theme}: {text}/{bg}')
        self.assertEqual(len(set(colors)),6)

    def test_blocked_storage_never_claims_display_was_saved(self):
        self.context.add_init_script("Storage.prototype.setItem=function(){throw Error('Storage disabled')}")
        self.open()
        self.page.locator('#appearance').evaluate('e=>e.open=true')
        self.page.locator('#theme').select_option('moss')
        self.assertEqual(self.page.locator('html').get_attribute('data-theme'),'moss')
        self.assertNotIn('saved', self.page.locator('#uiStatus').inner_text().lower())
        self.assertIn('cannot be saved',self.page.locator('#storageStatus').inner_text())

    def test_display_shortcut_opens_settings_and_mobile_focus_clears_transport(self):
        self.open()
        self.page.set_viewport_size({'width':1280,'height':900})
        self.page.locator('.desk-link').click()
        self.assertTrue(self.page.locator('#appearance').evaluate('e=>e.open'))
        self.page.set_viewport_size({'width':390,'height':844})
        self.page.locator('#textureControls').evaluate('e=>e.open=true')
        self.page.evaluate("document.getElementById('ambience').blur();const e=document.getElementById('ambience');window.scrollTo(0,window.scrollY+e.getBoundingClientRect().top-780);e.focus()")
        self.page.wait_for_timeout(150)
        bottom=self.page.locator('#ambience').evaluate('e=>e.getBoundingClientRect().bottom')
        transport_top=self.page.locator('.transport').evaluate('e=>e.getBoundingClientRect().top')
        self.assertLess(bottom,transport_top,'A focused control is hidden behind the mobile transport')

if __name__ == '__main__':
    unittest.main(verbosity=2)
