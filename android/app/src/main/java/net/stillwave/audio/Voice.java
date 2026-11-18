package net.stillwave.audio;

import java.util.Arrays;
import static net.stillwave.audio.Composer.*;

/** One synthesizer voice: a port of Voice in web/js/engine/synth.js. Preallocated; start() never allocates. */
final class Voice {
    private static final double TAU = Math.PI * 2;
    // attack s, decay time-constant s, sustain level, release s (to -60 dB), gain
    static final double[][] ENV = {
        {1.2, 3, .8, 2.5, .5}, {1.5, 3, .8, 3, .5}, {1.8, 4, .75, 3, .32}, {1.2, 3, .7, 3, .42}, {.08, 2, .85, .6, .3},
        {.004, 1.6, 0, .4, .55}, {.003, 2.2, 0, 1.6, .62}, {.002, 4, 0, .25, 1.1}, {.003, 2.6, 0, .6, .62}, {.002, .8, 0, .35, .7},
        {1.6, 4, .8, 3, .2}, {.12, 3, .85, .6, .5}, {.02, 1.5, .6, .25, .45}, {1, 4, .9, 2, .36}, {.003, .3, .15, .15, .32},
        {.004, 1.8, 0, 1.3, .58}, {.001, .2, 0, .05, .8}, {.001, .11, 0, .05, .45}, {.001, .035, 0, .02, .16}, {.012, .05, 0, .03, .32},
        {.001, .03, 0, .02, .5}, {.03, .17, 0, .08, .3},
    };
    private final double sr;
    final Rng rng = new Rng(1);
    private final double[] ph = new double[6], inc = new double[6], amp = new double[6], coef = new double[6];
    private final Svf f1 = new Svf(), f2 = new Svf(), f3 = new Svf();
    private final float[] ks;
    boolean active, releasing;
    int inst, layer, stage;
    long t, length;
    double freq, gain, attack, decay, sustain, release, env, gl, gr, bright, y, delay, damp, lfo;
    private int write;

    Voice(double sampleRate) { sr = sampleRate; ks = new float[(int) Math.ceil(sampleRate / 25) + 4]; }

    static double blep(double p, double dt) {
        double v = 2 * p - 1;
        if (p < dt) { double x = p / dt; v -= x + x - x * x - 1; } else if (p > 1 - dt) { double x = (p - 1) / dt; v -= x * x + x + x + 1; }
        return v;
    }

    void start(int inst, int layer, int midi, double velocity, long length, double pan, long seed, double brightness) {
        double[] e = ENV[inst];
        this.inst = inst; this.layer = layer; active = true; t = 0; this.length = length; releasing = false;
        freq = 440 * Math.pow(2, (midi - 69) / 12.0);
        gain = velocity * e[4];
        attack = 1 / Math.max(1, e[0] * sr); decay = Math.exp(-1 / (e[1] * sr)); sustain = e[2];
        release = Math.exp(Math.log(.001) / (e[3] * sr)); env = 0; stage = 0;
        double angle = (Math.max(-1, Math.min(1, pan)) + 1) * Math.PI / 4;
        gl = Math.cos(angle); gr = Math.sin(angle);
        rng.s = (int) seed; if (rng.s == 0) rng.s = 1;
        bright = brightness; y = 0;
        for (int i = 0; i < 6; i++) { ph[i] = rng.next(); amp[i] = 0; }
        f1.reset(); f2.reset(); f3.reset();
        double f = freq;
        if (inst == WARM) f1.set(sr, f * (2 + 7 * brightness), .7);
        else if (inst == PIANO) {
            double d = .55 + f / 700;
            for (int n = 1; n <= 6; n++) {
                inc[n - 1] = f * n * Math.sqrt(1 + .00035 * n * n) / sr;
                amp[n - 1] = Math.pow(n, -1.4) * (n == 1 ? 1 : .35 + .65 * brightness) * (n > 4 ? .6 : 1);
                coef[n - 1] = Math.exp(-d * (1 + .55 * (n - 1)) / sr);
            }
        } else if (inst == PLUCK) {
            int size = ks.length;
            delay = Math.min(size - 3, Math.max(2, sr / f - .5));
            Arrays.fill(ks, 0);
            double smooth = 0, a = .06 + (.15 + .45 * brightness) * Math.min(1, f / 600);
            int filled = (int) Math.ceil(delay) + 1;
            for (int i = 0; i < filled; i++) { smooth += a * ((rng.next() * 2 - 1) - smooth); ks[i] = (float) smooth; }
            write = filled;
            damp = .4985 + .0012 * brightness - Math.min(.004, f / 400000);
        } else if (inst == SNARE) f1.set(sr, 1800, .8);
        else if (inst == HAT) f1.set(sr, 7200, .7);
        else if (inst == SHAKER) f1.set(sr, 5600, 1.4);
        else if (inst == RIM) f1.set(sr, 2100, 2);
        else if (inst == BRUSH) f1.set(sr, 4200, .5);
        else if (inst == FLUTE) f1.set(sr, f * 3, .5);
        else if (inst == MALLET) f1.set(sr, 2500, .7);
        lfo = rng.next();
    }

    private double noise() { return rng.next() * 2 - 1; }

    /** One mono sample; pitch is the global tape wow multiplier. */
    double next(double pitch) {
        double f = freq, time = t / sr;
        if (!releasing && t >= length) { releasing = true; stage = 2; }
        if (stage == 0) { env += attack; if (env >= 1) { env = 1; stage = 1; } }
        else if (stage == 1) env = sustain + (env - sustain) * decay;
        else env *= release;
        if ((stage == 2 || sustain == 0) && env < 1e-5 && t > 64) { active = false; return 0; }
        t++;
        double dt = f * (inst <= GLASS ? pitch : 1) / sr, s;
        switch (inst) {
            case SINE: ph[0] = (ph[0] + dt) % 1; s = Math.sin(TAU * ph[0]) + .12 * Math.sin(2 * TAU * ph[0]); break;
            case TRI: { ph[0] = (ph[0] + dt) % 1; double x = TAU * ph[0]; s = .81 * (Math.sin(x) - Math.sin(3 * x) / 9 + Math.sin(5 * x) / 25 - Math.sin(7 * x) / 49); break; }
            case WARM:
                ph[0] = (ph[0] + dt * 1.0025) % 1; ph[1] = (ph[1] + dt * .9975) % 1; ph[2] = (ph[2] + dt * .5) % 1;
                s = f1.run(.5 * (blep(ph[0], dt) + blep(ph[1], dt)) + .3 * Math.sin(TAU * ph[2])); break;
            case FMPAD: { ph[0] = (ph[0] + dt) % 1; ph[1] = (ph[1] + dt * 2) % 1; double index = .45 + .7 * Math.exp(-time * .6) * (.5 + bright); s = Math.sin(TAU * ph[0] + index * Math.sin(TAU * ph[1])); break; }
            case ORGAN: { ph[0] = (ph[0] + dt) % 1; double x = TAU * ph[0]; s = (Math.sin(x) + .5 * Math.sin(2 * x) + .28 * Math.sin(3 * x) + .14 * Math.sin(4 * x) * bright + .07 * Math.sin(6 * x) * bright) / 1.7; break; }
            case EPIANO: {
                ph[0] = (ph[0] + dt) % 1; ph[1] = (ph[1] + dt * 14) % 1; double index = (1.6 * (.4 + .6 * bright)) * Math.exp(-time * 2.6) + .22;
                s = Math.sin(TAU * ph[0] + index * Math.sin(TAU * ph[0])) + .07 * Math.exp(-time * 22) * Math.sin(TAU * ph[1]); break;
            }
            case BELL: ph[0] = (ph[0] + dt) % 1; ph[1] = (ph[1] + dt * 3.5) % 1; ph[2] = (ph[2] + dt * 2.76) % 1; s = Math.sin(TAU * ph[0] + 1.5 * Math.exp(-time * 1.2) * Math.sin(TAU * ph[1])) + .22 * Math.exp(-time * 2.5) * Math.sin(TAU * ph[2]); break;
            case PLUCK: {
                int size = ks.length;
                double read = write - delay; if (read < 0) read += size;
                int i0 = (int) Math.floor(read);
                double frac = read - i0, a = ks[i0 % size], b = ks[(i0 + 1) % size], yy = a + (b - a) * frac, out = (yy + y) * damp;
                y = yy; ks[write] = (float) out; write = (write + 1) % size;
                s = yy * 1.6; break;
            }
            case PIANO:
                s = 0;
                for (int n = 0; n < 6; n++) { ph[n] = (ph[n] + inc[n] * pitch) % 1; amp[n] *= coef[n]; s += amp[n] * Math.sin(TAU * ph[n]); }
                if (t < sr * .006) s += noise() * .05 * bright * (1 - t / (sr * .006)); break;
            case MALLET: ph[0] = (ph[0] + dt) % 1; ph[1] = (ph[1] + dt * 4.07) % 1; s = Math.sin(TAU * ph[0]) + .35 * Math.exp(-time * 14) * Math.sin(TAU * ph[1]); if (t < sr * .003) s += f1.run(noise()) * .25; break;
            case CHOIR: {
                ph[0] = (ph[0] + dt * 1.003) % 1; ph[1] = (ph[1] + dt * .997) % 1;
                if ((t & 63) == 1) { double m = .5 + .5 * Math.sin(TAU * (lfo + time * .07)); f1.set(sr, 800 - 350 * m, 6); f2.set(sr, 1150 - 350 * m, 7); f3.set(sr, 2900 - 120 * m, 9); }
                double src = blep(ph[0], dt) + blep(ph[1], dt);
                f1.run(src); f2.run(src); f3.run(src);
                s = (f1.band + .6 * f2.band + .25 * f3.band) * .9; break;
            }
            case FLUTE: {
                double vibrato = 1 + .0045 * Math.sin(TAU * (5.2 * time + lfo)) * Math.min(1, time / .7);
                ph[0] = (ph[0] + dt * vibrato) % 1; double x = TAU * ph[0];
                s = Math.sin(x) + .18 * Math.sin(2 * x) + .06 * Math.sin(3 * x) + .1 * f1.run(noise()); break;
            }
            case BASS: { ph[0] = (ph[0] + dt) % 1; double x = TAU * ph[0]; s = Math.sin(x) + (.18 + .25 * bright) * Math.sin(2 * x) + .06 * Math.sin(3 * x); break; }
            case SUB: ph[0] = (ph[0] + dt) % 1; s = Math.sin(TAU * ph[0]) + .06 * Math.sin(2 * TAU * ph[0]); break;
            case SYNTH:
                ph[0] = (ph[0] + dt) % 1; ph[1] = (ph[1] + dt * 1.006) % 1;
                if ((t & 15) == 1) f1.set(sr, f * (1.2 + (3 + 9 * bright) * Math.exp(-time * 9)), 1.4);
                s = f1.run(.5 * (blep(ph[0], dt) + blep(ph[1], dt))); break;
            case GLASS: ph[0] = (ph[0] + dt) % 1; ph[1] = (ph[1] + dt * 2.76) % 1; ph[2] = (ph[2] + dt * 5.4) % 1; s = Math.sin(TAU * ph[0]) + .3 * Math.exp(-time * 3) * Math.sin(TAU * ph[1]) + .12 * Math.exp(-time * 6) * Math.sin(TAU * ph[2]); break;
            case KICK: ph[0] = (ph[0] + (44 + 80 * Math.exp(-time * 30)) / sr) % 1; s = Math.sin(TAU * ph[0]) + (t < sr * .002 ? noise() * .2 : 0); break;
            case SNARE: s = f1.run(noise()) * 1.4 * Math.exp(-time * 4) + .4 * Math.exp(-time * 35) * Math.sin(TAU * 190 * time); break;
            case HAT: f1.run(noise()); s = f1.high; break;
            case SHAKER: f1.run(noise()); s = f1.band * 1.5; break;
            case RIM: f1.run(noise()); s = .6 * Math.sin(TAU * 820 * time) * Math.exp(-time * 70) + f1.band * .8; break;
            case BRUSH: s = f1.run(noise()); break;
            default: s = 0;
        }
        return s * env * gain;
    }
}
