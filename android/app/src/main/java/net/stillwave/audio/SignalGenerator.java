package net.stillwave.audio;

import static net.stillwave.audio.Composer.*;

/** Composer + voice pool + mixer + effects, owned by the audio worker only.
 * A port of Renderer in web/js/engine/synth.js; keep both in step. Allocation-free while rendering
 * (a new Composer is created only when the seed changes). Amplitude modulation covers the broad
 * music bus, not a selected frequency band; bass, drums and ambience bypass it.
 */
public final class SignalGenerator implements Composer.Sink {
    private static final double TAU = Math.PI * 2;
    private static final String[] TEXTURES = {"rain", "stream", "ocean", "wind", "fire", "night", "brown", "pink"};
    private static final int CAP = 512, LOG = 64;
    private final int sampleRate;
    private final double ramp, smooth;
    private final Voice[] voices = new Voice[40];
    private final double[] evTime = new double[CAP], evDur = new double[CAP], evVel = new double[CAP], evPan = new double[CAP];
    private final int[] evMidi = new int[CAP], evInst = new int[CAP], evLayer = new int[CAP];
    private final double[] textures = new double[TEXTURES.length], fdnLp = new double[4], fdnGain = new double[4], fdnOut = new double[4];
    private final float[] dL, dR, pre;
    private final float[][] fdn = new float[4][], ap = new float[4][];
    private final int[] fdnLen = new int[4], fdnIdx = new int[4], apLen = new int[4], apIdx = new int[4];
    private final Svf windF = new Svf(), streamF = new Svf();
    private final Rng noiseRng, voiceSeed;
    private Composer composer;
    private Settings settings, pending;
    private int head, count, dWrite, preIdx, dSize, preLen;
    private long frames, barStart;
    private double sinkBar, sinkSpb;
    private boolean playing;
    private double envelope, volume, intensity, rate, music, bass, melody, beat, space, stereo, ambienceVolume, tone, tape, vinyl, delayMix, size, dTime;
    private double amPhase, wow, flutter, lp1L, lp1R, lp2L, lp2R, brown, slow, mid, fast, crackle, drip, ambL, ambR, pop, limit = 1;

    public SignalGenerator(int sampleRate, Settings settings) {
        if (sampleRate != 44100 && sampleRate != 48000) throw new IllegalArgumentException("Unsupported sample rate");
        this.sampleRate = sampleRate; this.settings = settings;
        double sr = sampleRate;
        composer = new Composer(settings);
        for (int i = 0; i < voices.length; i++) voices[i] = new Voice(sr);
        barStart = Math.round(sr * .05);
        noiseRng = new Rng((int) settings.seed ^ 0x51f15e);
        voiceSeed = new Rng((int) settings.seed ^ 0x2545f491);
        volume = settings.volume; intensity = settings.intensity; rate = settings.rate;
        music = settings.musicVolume; bass = settings.bassVolume; melody = settings.melodyVolume; beat = settings.beatVolume;
        space = settings.space; stereo = settings.stereo; ambienceVolume = settings.ambienceVolume;
        tone = toneTarget();
        int texture = index(settings.ambience); if (texture >= 0) textures[texture] = 1;
        tape = composer.style.tape; vinyl = composer.style.vinyl; delayMix = composer.style.delay; size = composer.style.reverb;
        ramp = 1 / (sr * .3); smooth = 1 - Math.exp(-1 / (sr * .2));
        windF.set(sr, 600, 2); streamF.set(sr, 900, 6);
        dSize = (int) Math.ceil(sr * 1.6); dL = new float[dSize]; dR = new float[dSize];
        dTime = delayTarget();
        double[] lengths = {.0371, .0437, .0497, .0563};
        for (int i = 0; i < 4; i++) { fdnLen[i] = (int) Math.round(lengths[i] * sr * 1.9); fdn[i] = new float[fdnLen[i]]; }
        double[] diffusers = {.0047, .0036, .0127, .0093};
        for (int i = 0; i < 4; i++) { apLen[i] = (int) Math.round(sr * diffusers[i]); ap[i] = new float[apLen[i]]; }
        preLen = (int) Math.round(sr * .018); pre = new float[preLen];
        updateReverb();
    }

    private static int index(String texture) { for (int i = 0; i < TEXTURES.length; i++) if (TEXTURES[i].equals(texture)) return i; return -1; }
    private double toneTarget() { return 1 - Math.exp(-TAU * 650 * Math.pow(2, settings.brightness * 5) / sampleRate); }
    private double delayTarget() { return Math.min(dSize - 4, sampleRate * 60 / composer.bpm * .75); }
    private void updateReverb() {
        double rt60 = 1.1 + 4.6 * size * (.35 + .65 * space);
        for (int i = 0; i < 4; i++) fdnGain[i] = Math.pow(10, -3 * fdnLen[i] / (rt60 * sampleRate));
    }
    public void setSettings(Settings next) { pending = next; settings = next; }
    public void setPlaying(boolean playing) { this.playing = playing; }
    public long framesGenerated() { return frames; }
    public boolean isSilent() { return envelope == 0; }

    @Override public void note(double beatOffset, double beats, int midi, double velocity, int instrument, int layer, double pan) {
        if (count >= CAP) return;
        double time = sinkBar + beatOffset * sinkSpb;
        int slot = (head + count) % CAP, moved = 0;
        while (moved < count) {
            int prev = (slot - 1 + CAP) % CAP;
            if (evTime[prev] <= time || evTime[prev] < sinkBar) break;
            evTime[slot] = evTime[prev]; evDur[slot] = evDur[prev]; evMidi[slot] = evMidi[prev]; evVel[slot] = evVel[prev];
            evInst[slot] = evInst[prev]; evLayer[slot] = evLayer[prev]; evPan[slot] = evPan[prev];
            slot = prev; moved++;
        }
        evTime[slot] = time; evDur[slot] = beats * sinkSpb; evMidi[slot] = midi; evVel[slot] = velocity;
        evInst[slot] = instrument; evLayer[slot] = layer; evPan[slot] = pan; count++;
    }

    private void composeUntil(long frame) {
        while (barStart < frame) {
            if (pending != null) {
                if (pending.seed != composer.settings.seed) { composer = new Composer(pending); voiceSeed.reseed((int) pending.seed ^ 0x2545f491); }
                else composer.configure(pending, false);
                pending = null;
            }
            double spb = sampleRate * 60 / composer.bpm;
            sinkBar = barStart; sinkSpb = spb;
            composer.bar(this);
            barStart += Math.round(spb * 4);
        }
    }

    private void trigger(int slot) {
        Voice voice = null;
        double quietest = 2;
        for (Voice v : voices) {
            if (!v.active) { voice = v; break; }
            double level = v.env * (v.releasing ? .5 : 1) * (v.layer == BASS_LAYER ? 3 : 1);
            if (level < quietest) { quietest = level; voice = v; }
        }
        voice.start(evInst[slot], evLayer[slot], evMidi[slot], evVel[slot], Math.max(1, Math.round(evDur[slot])), evPan[slot], (long) Math.floor(voiceSeed.next() * 4294967295.0), settings.brightness);
    }

    private double rampTo(double current, double target) { double d = target - current; return Math.abs(d) <= ramp ? target : current + (d > 0 ? ramp : -ramp); }

    public void render(float[] output, int frameCount) {
        if (frameCount < 0 || frameCount > output.length / 2) throw new IllegalArgumentException("Insufficient stereo buffer");
        Settings s = settings;
        double sr = sampleRate;
        int texture = index(s.ambience);
        boolean allMuted = s.musicVolume == 0 && s.bassVolume == 0 && s.melodyVolume == 0 && s.beatVolume == 0 && (texture < 0 || s.ambienceVolume == 0);
        double targetVolume = allMuted ? 0 : s.volume, toneGoal = toneTarget();
        composeUntil(frames + frameCount + Math.round(sr * .1));
        Style st = composer.style;
        for (int n = 0; n < frameCount; n++, frames++) {
            while (count > 0 && evTime[head] <= frames) { trigger(head); head = (head + 1) % CAP; count--; }
            volume = rampTo(volume, targetVolume); intensity = rampTo(intensity, s.intensity);
            rate += (s.rate - rate) * smooth; tone += (toneGoal - tone) * smooth;
            music = rampTo(music, s.musicVolume); bass = rampTo(bass, s.bassVolume);
            melody = rampTo(melody, s.melodyVolume); beat = rampTo(beat, s.beatVolume);
            space = rampTo(space, s.space); stereo = rampTo(stereo, s.stereo);
            ambienceVolume = rampTo(ambienceVolume, s.ambienceVolume);
            tape += (st.tape - tape) * smooth; vinyl += (st.vinyl - vinyl) * smooth;
            delayMix += (st.delay - delayMix) * smooth; size += (st.reverb - size) * smooth;
            dTime += (delayTarget() - dTime) * smooth * .2;
            for (int i = 0; i < textures.length; i++) textures[i] += ((i == texture ? 1 : 0) - textures[i]) * smooth;
            if ((frames & 1023) == 0) updateReverb();
            envelope = playing ? Math.min(1, envelope + 1 / (sr * .4)) : Math.max(0, envelope - 1 / (sr * .18));

            wow += .45 / sr; if (wow >= 1) wow -= 1;
            flutter += 6.1 / sr; if (flutter >= 1) flutter -= 1;
            double pitch = 1 + tape * (.0028 * Math.sin(TAU * wow) + .0007 * Math.sin(TAU * flutter));
            double padL = 0, padR = 0, melL = 0, melR = 0, bassS = 0, drumL = 0, drumR = 0;
            for (Voice v : voices) {
                if (!v.active) continue;
                double x = v.next(pitch);
                if (v.layer == PAD || v.layer == ARP) { padL += x * v.gl; padR += x * v.gr; }
                else if (v.layer == MELODY) { melL += x * v.gl; melR += x * v.gr; }
                else if (v.layer == BASS_LAYER) bassS += x;
                else { drumL += x * v.gl; drumR += x * v.gr; }
            }
            amPhase += rate / sr; if (amPhase >= 1) amPhase -= 1;
            double am = 1 - intensity * .5 + intensity * .5 * Math.sin(TAU * amPhase);
            double mL = (padL * music + melL * melody) * am, mR = (padR * music + melR * melody) * am;
            double noise = noiseRng.next() * 2 - 1;
            if (tape > .001 || vinyl > .001) {
                pop *= .9; if (noiseRng.next() < .00012 * vinyl) pop = noiseRng.next() * .5;
                double grain = (noise * .006 * tape + pop * .08 * vinyl) * music;
                mL += grain; mR += grain;
                double drive = 1 + tape * .8;
                mL = Math.tanh(mL * drive) / drive; mR = Math.tanh(mR * drive) / drive;
            }
            lp1L += tone * (mL - lp1L); lp2L += tone * (lp1L - lp2L);
            lp1R += tone * (mR - lp1R); lp2R += tone * (lp1R - lp2R);
            mL = lp2L; mR = lp2R;
            double bassOut = bassS * bass, dl = drumL * beat, dr = drumR * beat;

            double read = dWrite - dTime; if (read < 0) read += dSize;
            int i0 = (int) Math.floor(read), i1 = (i0 + 1) % dSize;
            double frac = read - i0, echoL = dL[i0] + (dL[i1] - dL[i0]) * frac, echoR = dR[i0] + (dR[i1] - dR[i0]) * frac;
            double feedback = .28 + .32 * space, send = delayMix * (.35 + .65 * space);
            dL[dWrite] = (float) ((melL * melody * am + padL * music * am * .3) * send + echoR * feedback);
            dR[dWrite] = (float) (echoL * feedback);
            dWrite = (dWrite + 1) % dSize;

            double input = (mL + mR) * .5 + bassOut * .2 + (dl + dr) * .1 + (echoL + echoR) * .3;
            double delayed = pre[preIdx]; pre[preIdx] = (float) input; preIdx = (preIdx + 1) % preLen;
            input = delayed;
            for (int a = 0; a < 2; a++) {
                float[] buf = ap[a]; int idx = apIdx[a];
                double held = buf[idx], v = input + held * .6;
                buf[idx] = (float) v; apIdx[a] = (idx + 1) % apLen[a]; input = held - v * .6;
            }
            double o0 = fdn[0][fdnIdx[0]], o1 = fdn[1][fdnIdx[1]], o2 = fdn[2][fdnIdx[2]], o3 = fdn[3][fdnIdx[3]];
            double sum = (o0 + o1 + o2 + o3) * .5, damp = .35 - .25 * s.brightness;
            fdnOut[0] = o0; fdnOut[1] = o1; fdnOut[2] = o2; fdnOut[3] = o3;
            for (int k = 0; k < 4; k++) {
                fdnLp[k] += (1 - damp) * ((fdnOut[k] - sum) * fdnGain[k] - fdnLp[k]);
                fdn[k][fdnIdx[k]] = (float) (input + fdnLp[k]);
                fdnIdx[k] = (fdnIdx[k] + 1) % fdnLen[k];
            }
            double wetL = o0 + o2 * .6, wetR = o1 + o3 * .6;
            for (int a = 2; a < 4; a++) {
                float[] buf = ap[a]; int idx = apIdx[a];
                double src = a == 2 ? wetL : wetR, held = buf[idx], v = src + held * .5;
                buf[idx] = (float) v; apIdx[a] = (idx + 1) % apLen[a];
                if (a == 2) wetL = held - v * .5; else wetR = held - v * .5;
            }
            double wet = space * (.35 + .45 * size);

            double air = 0, airR = 0;
            double textureSum = 0; for (double tx : textures) textureSum += tx;
            if (ambienceVolume > 0 && (texture >= 0 || textureSum > 1e-4)) {
                double[] tx = textures;
                double seconds = frames / sr;
                brown = .997 * brown + .035 * noise; slow = .98 * slow + .02 * noise; mid = .85 * mid + .15 * noise; fast = .5 * fast + .5 * noise;
                double pink = slow * 2.5 + mid * .8 + fast * .3 + noise * .08;
                crackle *= .985; if (noiseRng.next() < .0007) crackle = .3 + noiseRng.next() * .7;
                drip *= .993; if (noiseRng.next() < .0009) drip = noiseRng.next();
                if ((frames & 255) == 0) { windF.set(sr, 400 + 500 * (.5 + .5 * Math.sin(seconds * .37) * Math.sin(seconds * .11)), 1.6); streamF.set(sr, 600 + noiseRng.next() * 1400, 7); }
                double gust = Math.sin(seconds * Math.PI / 5), wind = windF.run(noise) * (.5 + .5 * gust * gust) * 2;
                double stream = streamF.run(noise) * 1.8 + mid * .3, swell = Math.sin(seconds * Math.PI / 9);
                double cycle = (seconds * 1.1) % 1, chirp = cycle < .3 ? Math.sin(TAU * 4300 * seconds) * Math.max(0, Math.sin(TAU * cycle * 23)) * (.5 + .5 * Math.sin(seconds * .23)) : 0;
                double value = tx[0] * (noise * .35 + fast * .2 + drip * noise * .55) + tx[1] * stream + tx[2] * pink * (.2 + .8 * swell * swell) + tx[3] * wind
                        + tx[4] * (brown * .5 + noise * crackle) + tx[5] * (chirp * .18 + slow * .6) + tx[6] * brown * 2.5 + tx[7] * pink;
                ambL += .35 * (Math.tanh(value) * ambienceVolume * .28 - ambL);
                ambR += .35 * (Math.tanh(value * (1 - .3 * tx[2]) + mid * .2 * (tx[0] + tx[3])) * ambienceVolume * .28 - ambR);
                air = ambL; airR = ambR;
            }

            double left = mL + bassOut + dl + wetL * wet + air, right = mR + bassOut + dr + wetR * wet + airR;
            double middle = (left + right) * .5, side = (left - right) * .5 * stereo;
            left = middle + side; right = middle - side;
            double peak = Math.max(Math.abs(left), Math.abs(right));
            limit = peak * limit > .7 ? .7 / peak : Math.min(1, limit + .00002);
            double gain = volume * envelope * .9;
            output[n * 2] = gain == 0 ? 0 : (float) (Math.tanh(left * limit) * gain);
            output[n * 2 + 1] = gain == 0 ? 0 : (float) (Math.tanh(right * limit) * gain);
        }
    }
}
