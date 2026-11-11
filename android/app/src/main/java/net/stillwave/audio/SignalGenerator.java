package net.stillwave.audio;

/** Stateful, allocation-free stereo synthesis, owned by the audio worker only.
 * AM is applied to low/mid pads, never to the bass or air. This is an audible
 * musical effect, not a medical treatment or a claim about brain entrainment.
 */
public final class SignalGenerator {
    private static final double TAU = Math.PI * 2;
    private static final int[][] CHORDS = {{0, 3, 7}, {0, 5, 8}, {-2, 3, 7}, {-5, 2, 7}};
    private final int sampleRate;
    private final double smoothing;
    private final double[] phaseL = new double[3], phaseR = new double[3], frequencies = new double[3];
    private Settings settings;
    private long frames, rng;
    private double volume, intensity, rate, ambienceVolume, rainMix, brownMix, deepMix, lofiMix;
    private double envelope, amPhase, bassPhase, notePhase, brown, air, rain;
    private boolean playing;

    public SignalGenerator(int sampleRate, Settings settings) {
        if (sampleRate != 44100 && sampleRate != 48000) throw new IllegalArgumentException("Unsupported sample rate");
        this.sampleRate = sampleRate;
        this.settings = settings;
        smoothing = 1 - Math.exp(-1.0 / (sampleRate * .22));
        volume = settings.volume; intensity = settings.intensity; rate = settings.rate;
        ambienceVolume = settings.ambienceVolume;
        rng = settings.seed;
        for (int i = 0; i < 3; i++) {
            phaseL[i] = random() * TAU; phaseR[i] = phaseL[i] + .13;
            frequencies[i] = 220 * Math.pow(2, CHORDS[0][i] / 12.0);
        }
    }

    public void setSettings(Settings next) {
        if (next.seed != settings.seed) rng = next.seed;
        settings = next;
    }
    public void setPlaying(boolean playing) { this.playing = playing; }
    public long framesGenerated() { return frames; }
    public boolean isSilent() { return envelope == 0; }

    private double random() {
        rng ^= rng << 13; rng ^= rng >>> 7; rng ^= rng << 17;
        return (rng >>> 11) * 0x1.0p-53;
    }
    private static double wrap(double value) { return value >= TAU ? value - TAU : value; }
    private double ease(double current, double target) { return current + (target - current) * smoothing; }

    public void render(float[] output, int frameCount) {
        if (frameCount < 0 || frameCount > output.length / 2) throw new IllegalArgumentException("Insufficient stereo buffer");
        Settings s = settings;
        for (int n = 0; n < frameCount; n++, frames++) {
            volume = ease(volume, s.volume); intensity = ease(intensity, s.intensity);
            rate = ease(rate, s.rate); ambienceVolume = ease(ambienceVolume, s.ambienceVolume);
            rainMix = ease(rainMix, s.ambience.equals("rain") ? 1 : 0);
            brownMix = ease(brownMix, s.ambience.equals("brown") ? 1 : 0);
            deepMix = ease(deepMix, s.style.equals("deep") ? 1 : 0);
            lofiMix = ease(lofiMix, s.style.equals("lofi") ? 1 : 0);
            envelope = playing ? Math.min(1, envelope + 1.0 / (sampleRate * .4)) : Math.max(0, envelope - 1.0 / (sampleRate * .18));
            double seconds = frames / (double) sampleRate;
            int chord = (int) (seconds / 18) % CHORDS.length;
            double transpose = s.mode.equals("sleep") ? -2 : s.mode.equals("relax") ? -1 : s.mode.equals("meditate") ? 2 : 0;
            double left = 0, right = 0;
            for (int v = 0; v < 3; v++) {
                double target = 220 * Math.pow(2, (CHORDS[chord][v] + transpose) / 12.0);
                frequencies[v] = ease(frequencies[v], target);
                phaseL[v] = wrap(phaseL[v] + TAU * frequencies[v] * .9987 / sampleRate);
                phaseR[v] = wrap(phaseR[v] + TAU * frequencies[v] * 1.0013 / sampleRate);
                double weight = .13 * (1 - .3 * deepMix);
                left += weight * (Math.sin(phaseL[v]) + .19 * Math.sin(phaseL[v] * 2));
                right += weight * (Math.sin(phaseR[v]) + .19 * Math.sin(phaseR[v] * 2));
            }
            amPhase = wrap(amPhase + TAU * rate / sampleRate);
            double modulation = 1 - intensity * .5 + intensity * .5 * Math.sin(amPhase);
            left *= modulation; right *= modulation;
            bassPhase = wrap(bassPhase + TAU * frequencies[0] / (4 * sampleRate));
            double bass = (.12 + .06 * deepMix) * Math.sin(bassPhase);
            notePhase = wrap(notePhase + TAU * frequencies[2] * 1.5 / sampleRate);
            double noteWindow = Math.pow(Math.max(0, Math.sin(seconds * .45)), 6);
            double note = .045 * (1 - deepMix * .6) * noteWindow * Math.sin(notePhase);
            double noise = random() * 2 - 1;
            brown = .998 * brown + .035 * noise;
            rain = .86 * rain + .14 * noise;
            air = .97 * air + .03 * noise;
            double texture = .014 * air + ambienceVolume * (.13 * brownMix * brown + .16 * rainMix * rain);
            double lofi = lofiMix * .035 * rain * (.4 + .6 * Math.pow(Math.sin(seconds * Math.PI), 2));
            double gain = volume * envelope * .8;
            output[n * 2] = gain == 0 ? 0 : (float) (Math.tanh(left + bass + note + texture + lofi) * gain);
            output[n * 2 + 1] = gain == 0 ? 0 : (float) (Math.tanh(right + bass + note + texture + lofi) * gain);
        }
    }
}
