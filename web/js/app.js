import {MODE_DEFAULTS, MODES, STYLES, SYNTHS, AMBIENCES, SCALES, THEMES, DURATIONS, normalizeSettings, loadSettings, saveSettings, formatTime} from './settings.js';
import {NativeEngine} from './native.js';
import {StillwaveEngine, renderWav} from './audio.js';
import {setupOffline} from './offline.js';
import {Score, ComposerClock, WINDOW} from './score.js';

// Factory Android WebViews cannot parse top-level await; everything runs inside bootstrap().
function bootstrap() {
  const $ = id => document.getElementById(id);
  const native = Boolean(window.NativeAudio);
  const engine = native ? new NativeEngine(window.NativeAudio) : new StillwaveEngine();
  let settings = loadSettings(), state = {playing: false, elapsed: 0}, busy = false, hasSession = false;

  const STYLE_INFO = {
    ambient: ['Ambient', 'Slow pads and distant bells'], lofi: ['Lo-fi', 'Warm keys, soft beat'], piano: ['Piano', 'Felt piano, open harmony'],
    kalimba: ['Kalimba', 'Bright plucked tines'], pulse: ['Pulse', 'Steady patterns for deep work'], glass: ['Glass', 'Shimmering arpeggios'],
    drift: ['Drift', 'Wide, unhurried swells'], choir: ['Choir', 'Airy voices'], tape: ['Tape', 'Worn organ, nostalgic'], deep: ['Deep', 'Low, dark and still'],
  };
  const MODE_NAMES = {focus: 'Focus', relax: 'Relax', sleep: 'Sleep', meditate: 'Meditate'};
  const AIR_NAMES = {none: 'None', rain: 'Rain', stream: 'Stream', ocean: 'Ocean', wind: 'Wind', fire: 'Fire', night: 'Night', brown: 'Brown', pink: 'Pink'};
  const SYNTH_NAMES = {auto: 'Style’s own', sine: 'Sine', triangle: 'Triangle', warm: 'Warm pad', fm: 'FM pad', organ: 'Organ', epiano: 'Electric piano', bell: 'Bell', pluck: 'Pluck'};
  const KEYS = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  const THEME_NAMES = {auto: 'Auto', paper: 'Fog', sand: 'Sand', moss: 'Moss', dusk: 'Dusk', night: 'Tide', graphite: 'Graphite'};
  const MIX = [['volume', 'i-volume', 'Volume'], ['musicVolume', 'i-chords', 'Chords'], ['melodyVolume', 'i-melody', 'Melody'], ['bassVolume', 'i-bass', 'Bass'], ['beatVolume', 'i-beat', 'Beat'], ['ambienceVolume', 'i-air', 'Atmosphere'],
    ['brightness', 'i-tone', 'Tone'], ['space', 'i-space', 'Space'], ['stereo', 'i-width', 'Width'], ['density', 'i-density', 'Activity']];
  const PULSE = [['intensity', 'Depth', 0, .6, .01], ['rateHz', 'Rate', .25, 32, .25]];
  const icon = id => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;
  const option = (value, label, current) => `<option value="${value}"${String(value) === String(current) ? ' selected' : ''}>${label}</option>`;

  // Build repeated controls once; values are synced in render().
  $('styles').innerHTML = STYLES.map(style => `<button type="button" role="radio" class="style" data-style="${style}" title="${STYLE_INFO[style][1]}">${icon('s-' + style)}<span>${STYLE_INFO[style][0]}</span></button>`).join('');
  $('airs').innerHTML = AMBIENCES.map(air => `<button type="button" role="radio" class="air" data-air="${air}">${icon('a-' + air)}<span>${AIR_NAMES[air]}</span></button>`).join('');
  $('durations').innerHTML = DURATIONS.map(d => `<button type="button" role="radio" class="choice" data-duration="${d}">${d ? d + ' min' : 'No limit'}</button>`).join('');
  $('themes').innerHTML = THEMES.map(theme => `<button type="button" role="radio" class="swatch" data-theme-choice="${theme}" aria-label="${THEME_NAMES[theme]} theme"><i data-swatch="${theme}"></i><span>${THEME_NAMES[theme]}</span></button>`).join('');
  $('textScales').innerHTML = [[1, 'A'], [1.15, 'A+'], [1.3, 'A++']].map(([v, l]) => `<button type="button" role="radio" data-text-scale="${v}">${l}</button>`).join('');
  const slider = ([key, glyph, label, min = 0, max = 1, step = .01]) => `<label class="slider">${glyph ? icon(glyph) : ''}<span class="slider-label">${label}</span><input type="range" min="${min}" max="${max}" step="${step}" data-key="${key}" id="${key}"><output id="${key}Value"></output></label>`;
  $('sliders').innerHTML = MIX.map(slider).join('');
  $('pulseSliders').innerHTML = PULSE.map(([key, label, min, max, step]) => slider([key, '', label, min, max, step])).join('');
  $('synth').innerHTML = SYNTHS.map(s => option(s, SYNTH_NAMES[s])).join('');
  $('key').innerHTML = option(-1, 'Automatic') + KEYS.map((k, i) => option(i, k)).join('');
  $('scale').innerHTML = SCALES.map(s => option(s, s === 'auto' ? 'Automatic' : s[0].toUpperCase() + s.slice(1))).join('');

  // Score: real note-ons from the web engine, a synchronized shadow composer for native audio.
  const score = new Score($('score'));
  const reducedMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let preview = new ComposerClock(settings), shadow = native ? new ComposerClock(settings) : null, shadowBase = 0, shadowAt = 0, frame = 0, lastDraw = 0;
  function motionAllowed() { return settings.visualizer && settings.motionEnabled && state.playing && !document.hidden && !(reducedMotion && reducedMotion.matches); }
  function drawScore() {
    const canvas = $('score');
    canvas.hidden = !settings.visualizer;
    if (!settings.visualizer) return;
    if (!hasSession && !state.playing) { score.draw(preview.advance(WINDOW + 1), WINDOW, {idle: true}); return; }
    if (native) {
      const now = shadowBase + (state.playing ? (performance.now() - shadowAt) / 1000 : 0);
      score.draw(shadow.advance(now + 1), now);
    } else score.draw(engine.getNotes(), engine.now(), {level: engine.getLevel()});
    canvas.setAttribute('data-drawn', String(Date.now()));
  }
  const canvas = () => $('score');
  function animate(time) {
    frame = 0;
    if (!motionAllowed()) { canvas().setAttribute('data-running', 'false'); return; }
    if (time - lastDraw > 33) { drawScore(); lastDraw = time; }
    frame = requestAnimationFrame(animate);
  }
  function syncMotion() {
    const running = motionAllowed();
    canvas().setAttribute('data-running', String(running));
    canvas().setAttribute('data-source', native ? 'composer' : 'engine');
    if (running && !frame) frame = requestAnimationFrame(animate);
    if (!running) { if (frame) cancelAnimationFrame(frame); frame = 0; drawScore(); }
  }

  function announce(message, error) { $('status').textContent = message || ''; $('status').classList.toggle('error', Boolean(error)); }
  function persist() {
    const saved = saveSettings(settings);
    $('storageStatus').textContent = saved ? '' : 'Settings can’t be saved in this browser. Sound still works.';
    return saved;
  }
  const pressed = (selector, attribute, value) => document.querySelectorAll(selector).forEach(el => { const on = el.getAttribute(attribute) === String(value); el.setAttribute('aria-checked', String(on)); el.classList.toggle('on', on); });

  function applyTheme() {
    const root = document.documentElement;
    const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', settings.theme === 'auto' ? (dark ? 'night' : 'paper') : settings.theme);
    root.style.setProperty('--text-scale', settings.textScale);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = getComputedStyle(root).getPropertyValue('--bg').trim();
  }
  function render() {
    applyTheme();
    const [name, tagline] = STYLE_INFO[settings.style];
    $('kicker').textContent = MODE_NAMES[settings.mode]; $('title').textContent = name; $('tagline').textContent = tagline;
    $('meta').textContent = (native ? shadow : preview).describe();
    pressed('[data-mode]', 'data-mode', settings.mode); pressed('[data-style]', 'data-style', settings.style);
    pressed('[data-air]', 'data-air', settings.ambience); pressed('[data-duration]', 'data-duration', settings.duration);
    pressed('[data-theme-choice]', 'data-theme-choice', settings.theme); pressed('[data-text-scale]', 'data-text-scale', settings.textScale);
    $('timerLabel').textContent = settings.duration ? `${settings.duration} min` : '∞';
    $('total').textContent = settings.duration ? ` / ${formatTime(settings.duration * 60)}` : '';
    for (const [key] of MIX.concat(PULSE)) {
      const input = $(key); input.value = settings[key];
      input.style.setProperty('--fill', `${(settings[key] - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100}%`);
      $(key + 'Value').textContent = key === 'rateHz' ? `${settings.rateHz} Hz` : `${Math.round(settings[key] * 100)}%`;
    }
    for (const key of ['synth', 'key', 'scale']) $(key).value = String(settings[key]);
    if (document.activeElement !== $('seed')) $('seed').value = settings.seed;
    $('motionEnabled').checked = settings.motionEnabled; $('visualizer').checked = settings.visualizer;
    $('pulseNote').textContent = settings.intensity === 0 ? 'Pulse is off.' : settings.mode === 'focus' && settings.rateHz === 16 ? 'Gentle loudness pulses on the music at 16 Hz. Not binaural beats; works on speakers. 0% turns them off.' : 'Experimental independent modulation rate. Not binaural beats. 0% turns it off.';
    renderState(); syncMotion();
  }
  function renderState() {
    const playing = Boolean(state.playing), elapsed = Number(state.elapsed) || 0;
    document.body.classList.toggle('is-playing', playing);
    $('elapsed').textContent = formatTime(elapsed);
    $('progress').style.width = settings.duration ? `${Math.min(100, elapsed / (settings.duration * 60) * 100)}%` : '0%';
    const label = busy ? 'One moment' : playing ? 'Pause' : hasSession || elapsed > 0 ? 'Resume' : 'Play';
    $('playButton').setAttribute('aria-label', label); $('playButton').disabled = busy;
    $('playIcon').innerHTML = `<use href="#i-${playing ? 'pause' : 'play'}"/>`;
    $('stopButton').disabled = busy || (!playing && !hasSession && elapsed === 0);
    $('newSound').disabled = busy;
  }
  function readState() {
    try {
      const next = engine.getState(), ended = hasSession && state.playing && !next.playing && next.elapsed === 0;
      if (native) { shadowBase = next.elapsed; shadowAt = performance.now(); }
      state = next;
      if (next.playing) hasSession = true;
      else if (ended) { hasSession = false; announce('Session complete.'); resetScore(); }
      if (next.error) announce(next.error, true);
      renderState(); syncMotion();
    } catch (error) { announce(`Playback status unavailable: ${error.message}`, true); }
  }
  function resetScore() { preview = new ComposerClock(settings); if (shadow) { shadow.reset(settings); shadowBase = 0; shadowAt = performance.now(); } }
  function update(patch, soundChange = true) {
    settings = normalizeSettings(Object.assign({}, settings, patch));
    persist();
    if (soundChange) {
      try { engine.update(settings); } catch (error) { announce(error.message, true); }
      preview = new ComposerClock(settings);
      if (shadow) shadow.update(settings);
    }
    render();
  }

  async function togglePlay() {
    if (busy) return;
    busy = true; renderState();
    try {
      if (state.playing) await engine.pause();
      else {
        if (!hasSession && shadow) { shadow.reset(settings); shadowBase = 0; }
        await engine.start(settings); hasSession = true; announce('');
      }
      state = engine.getState();
      if (native) { shadowBase = state.elapsed; shadowAt = performance.now(); }
      if (state.error) throw Error(state.error);
    } catch (error) { announce(error.message || 'Sound could not start. Try again.', true); }
    busy = false; renderState(); syncMotion();
  }
  function stop() {
    try { engine.stop(); state = engine.getState(); hasSession = false; resetScore(); announce(''); render(); }
    catch (error) { announce(error.message, true); }
  }

  // Sheets: native <dialog> with a simple fallback for engines without showModal.
  let opener = null;
  function openSheet(id) {
    const sheet = $(id); opener = document.activeElement;
    if (typeof sheet.showModal === 'function') { try { sheet.showModal(); } catch (error) { sheet.setAttribute('open', ''); } } else sheet.setAttribute('open', '');
    const first = sheet.querySelector('[data-close]'); if (first) first.focus();
  }
  function closeSheet(sheet) {
    if (typeof sheet.close === 'function') { try { sheet.close(); } catch (error) { sheet.removeAttribute('open'); } } else sheet.removeAttribute('open');
    if (opener && opener.focus) opener.focus();
  }
  document.querySelectorAll('dialog.sheet').forEach(sheet => {
    sheet.addEventListener('click', event => {
      if (event.target.closest('[data-close]')) { closeSheet(sheet); return; }
      if (event.target === sheet) { const r = sheet.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeSheet(sheet); }
    });
    sheet.addEventListener('cancel', event => { event.preventDefault(); closeSheet(sheet); });
  });
  document.addEventListener('keydown', event => {
    const open = document.querySelector('dialog.sheet[open]');
    if (open && event.key === 'Escape') { event.preventDefault(); closeSheet(open); return; }
    if (!open && event.key === ' ' && !event.target.closest('input,select,textarea,button,summary')) { event.preventDefault(); togglePlay(); }
  });

  // Delegated choices.
  document.addEventListener('click', event => {
    const el = event.target.closest('[data-mode],[data-style],[data-air],[data-duration],[data-theme-choice],[data-text-scale]');
    if (!el) return;
    if (el.dataset.mode) { const mode = el.dataset.mode; update(Object.assign({mode}, MODE_DEFAULTS[mode])); }
    else if (el.dataset.style) update({style: el.dataset.style});
    else if (el.dataset.air) update({ambience: el.dataset.air});
    else if (el.dataset.duration !== undefined) { update({duration: Number(el.dataset.duration)}); closeSheet($('timerSheet')); }
    else if (el.dataset.themeChoice) update({theme: el.dataset.themeChoice}, false);
    else if (el.dataset.textScale) update({textScale: Number(el.dataset.textScale)}, false);
  });
  for (const [key] of MIX.concat(PULSE)) $(key).addEventListener('input', event => update({[key]: Number(event.target.value)}));
  for (const key of ['synth', 'key', 'scale']) $(key).addEventListener('change', event => update({[key]: key === 'key' ? Number(event.target.value) : event.target.value}));
  $('motionEnabled').addEventListener('change', event => update({motionEnabled: event.target.checked}, false));
  $('visualizer').addEventListener('change', event => update({visualizer: event.target.checked}, false));
  $('seed').addEventListener('change', event => {
    const seed = Number(event.target.value);
    if (!Number.isSafeInteger(seed) || seed < 1) { event.target.value = settings.seed; announce('Use a positive whole number for the seed.', true); return; }
    update({seed});
  });
  $('playButton').addEventListener('click', togglePlay);
  $('stopButton').addEventListener('click', stop);
  $('newSound').addEventListener('click', async () => {
    const wasPlaying = state.playing;
    busy = true;
    try {
      engine.stop(); hasSession = false; state = engine.getState();
      settings = normalizeSettings(Object.assign({}, settings, {seed: Math.floor(Math.random() * 2147483646) + 1})); persist();
      resetScore(); render();
      if (wasPlaying) { if (native) await new Promise(r => setTimeout(r, 120)); await engine.start(settings); hasSession = true; state = engine.getState(); }
      announce('A new variation.');
    } catch (error) { announce(error.message, true); }
    busy = false; render();
  });
  $('mixerButton').addEventListener('click', () => openSheet('mixerSheet'));
  $('timerButton').addEventListener('click', () => openSheet('timerSheet'));
  $('settingsButton').addEventListener('click', () => openSheet('settingsSheet'));
  $('infoButton').addEventListener('click', () => openSheet('infoSheet'));
  $('resetSound').addEventListener('click', () => {
    if (!window.confirm('Reset sound settings and stop? Your look stays the same.')) return;
    stop();
    const look = {theme: settings.theme, textScale: settings.textScale, motionEnabled: settings.motionEnabled, visualizer: settings.visualizer, seed: settings.seed};
    settings = normalizeSettings(look); persist(); resetScore(); render(); announce('Sound settings reset.');
  });
  $('resetUI').addEventListener('click', () => update({theme: 'auto', textScale: 1, motionEnabled: true, visualizer: true}, false));
  document.querySelectorAll('.copy-source').forEach(button => button.addEventListener('click', () => {
    const url = button.parentElement.querySelector('.source-url').textContent.trim();
    const done = copied => { $('copyStatus').textContent = copied ? `Source ${button.dataset.source} copied. Open it in a browser.` : 'Copy unavailable. Select the address to copy it.'; };
    const fallback = () => {
      const field = document.createElement('textarea'); field.value = url; field.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(field); field.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (error) { ok = false; } field.remove(); done(ok);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(() => done(true), fallback); else fallback();
  }));

  let installEvent = null;
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installEvent = event; $('installPrompt').hidden = false; });
  $('installPrompt').addEventListener('click', () => { if (installEvent) { installEvent.prompt(); installEvent = null; $('installPrompt').hidden = true; } });

  $('exportButton').addEventListener('click', async () => {
    const seconds = Number($('exportLength').value);
    $('exportButton').disabled = true; $('exportStatus').textContent = 'Composing your recording…';
    try {
      const blob = await renderWav(settings, seconds, {onProgress: p => { $('exportStatus').textContent = `Composing… ${Math.round(p * 100)}%`; }});
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `stillwave-${settings.style}-${settings.seed}.wav`; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      $('exportStatus').textContent = 'Saved. A fresh rendering with your current settings.';
    } catch (error) { $('exportStatus').textContent = `Couldn’t save: ${error.message}`; }
    $('exportButton').disabled = false;
  });

  if (native) {
    $('offlineStatus').textContent = 'Built in · works offline';
    $('offlineButton').hidden = true;
    $('exportButton').disabled = true; $('exportStatus').textContent = 'Recording export is available in the web version.';
  } else setupOffline({button: $('offlineButton'), status: $('offlineStatus')});

  if (window.matchMedia) {
    const scheme = window.matchMedia('(prefers-color-scheme: dark)'), onScheme = () => render();
    if (scheme.addEventListener) scheme.addEventListener('change', onScheme); else if (scheme.addListener) scheme.addListener(onScheme);
    if (reducedMotion) { if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', syncMotion); else if (reducedMotion.addListener) reducedMotion.addListener(syncMotion); }
  }
  window.addEventListener('resize', () => drawScore());
  document.addEventListener('visibilitychange', () => { readState(); syncMotion(); });
  render(); persist(); readState(); setInterval(readState, native ? 1000 : 500);
  window.__stillwaveReady = true;
}
try { bootstrap(); } catch (error) {
  const status = document.getElementById('status');
  if (status) { status.textContent = `Stillwave couldn’t start: ${error.message}`; status.classList.add('error'); }
}
