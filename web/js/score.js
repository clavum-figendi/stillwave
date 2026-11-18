import {Composer} from './engine/composer.js';

const WINDOW = 14; // seconds visible
const LOW = 26, HIGH = 102;

/** Steps the shared composer on a seconds clock: a static preview, or a live shadow of the native engine. */
export class ComposerClock {
  constructor(settings) { this.reset(settings); }
  reset(settings) { this.composer = new Composer(settings); this.seed = settings.seed; this.barStart = .05; this.pending = null; this.notes = []; }
  update(settings) { this.pending = settings; }
  advance(until) {
    while (this.barStart < until) {
      if (this.pending) {
        if (this.pending.seed !== this.seed) { this.composer = new Composer(this.pending); this.seed = this.pending.seed; } else this.composer.configure(this.pending, false);
        this.pending = null;
      }
      const spb = 60 / this.composer.bpm, start = this.barStart, notes = this.notes;
      this.composer.bar({note(beat, beats, midi, velocity, inst, layer) { notes.push({time: start + beat * spb, midi, layer, velocity, length: beats * spb}); }});
      this.barStart += spb * 4;
    }
    if (this.notes.length > 600) this.notes.splice(0, this.notes.length - 600);
    return this.notes;
  }
  describe() {
    const c = this.composer, names = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
    return `${names[c.root % 12]} ${c.scaleName} · ${Math.round(c.bpm)} bpm`;
  }
}

/** A drifting graphic score: every note the composer plays, coloured by layer. */
export class Score {
  constructor(canvas) { this.canvas = canvas; this.paint = canvas.getContext('2d'); }
  draw(notes, now, {level = 0, idle = false} = {}) {
    const paint = this.paint, canvas = this.canvas;
    if (!paint) return;
    const box = canvas.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2), w = box.width, h = box.height;
    if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) { canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio); }
    paint.setTransform(ratio, 0, 0, ratio, 0, 0);
    paint.clearRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement), color = name => css.getPropertyValue(name).trim();
    const colors = [color('--pad'), color('--pad'), color('--mel'), color('--bass'), color('--beat')];
    const head = w * (idle ? 1 : .78), pxs = head / WINDOW, top = 56, bottom = h > 330 ? h - 168 : h * .52; // keep clear of the title
    const y = midi => bottom - (Math.max(LOW, Math.min(HIGH, midi)) - LOW) / (HIGH - LOW) * (bottom - top);
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i], age = now - n.time;
      if (age < 0 || age > WINDOW + n.length) continue;
      const x = head - age * pxs, fade = idle ? .9 : Math.max(.12, 1 - age / WINDOW);
      paint.fillStyle = colors[n.layer];
      if (n.layer === 4) { paint.globalAlpha = fade * .8; paint.fillRect(x - 1, h - 14 - 10 * n.velocity, 2, 10 * n.velocity); continue; }
      const len = Math.max(3, Math.min(n.length, age + (idle ? n.length : 0)) * pxs), thick = n.layer === 0 ? 5 + 6 * n.velocity : n.layer === 3 ? 7 : n.layer === 2 ? 4 : 3;
      paint.globalAlpha = fade * (n.layer === 0 ? .32 : n.layer === 3 ? .45 : .9);
      roundRect(paint, x, y(n.midi) - thick / 2, Math.max(thick, len), thick);
      if (n.layer === 2 && age < .6 && !idle) {
        paint.globalAlpha = (.6 - age) * .9;
        paint.beginPath(); paint.arc(x, y(n.midi), 4 + age * 18, 0, Math.PI * 2); paint.fill();
      }
    }
    paint.globalAlpha = 1;
    if (!idle) {
      paint.fillStyle = colors[2]; paint.globalAlpha = .18 + Math.min(.5, level * 3);
      paint.fillRect(head, top - 6, 1.5, bottom - top + 12);
      paint.globalAlpha = 1;
    }
  }
}
function roundRect(paint, x, y, w, h) {
  const r = Math.min(h / 2, w / 2);
  paint.beginPath(); paint.moveTo(x + r, y); paint.lineTo(x + w - r, y); paint.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  paint.lineTo(x + r, y + h); paint.arc(x + r, y + r, r, Math.PI / 2, Math.PI * 1.5); paint.fill();
}
export {WINDOW};
