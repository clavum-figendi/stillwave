package net.stillwave.audio;

import java.util.HashMap;
import java.util.Map;

/** Dependency-free contract tests: run with android/run-core-tests.sh. */
public final class CoreTests {
    private static int checks;
    static void check(boolean condition, String message) {
        checks++;
        if (!condition) throw new AssertionError(message);
    }
    public static void main(String[] args) {
        Settings defaults = Settings.from(Map.of());
        check(defaults.mode.equals("focus"), "default focus");
        check(defaults.rate == 16, "default rate 16 Hz");
        check(defaults.duration == 25, "default timer");
        check(defaults.seed > 0, "positive default seed");
        Map<String, Object> invalid = new HashMap<>();
        invalid.put("volume", 100);
        invalid.put("intensity", -2);
        invalid.put("rate", Double.NaN);
        invalid.put("ambienceVolume", Double.POSITIVE_INFINITY);
        invalid.put("duration", 17);
        invalid.put("seed", -1);
        invalid.put("style", "unknown");
        invalid.put("mode", "<script>");
        invalid.put("ambience", "remote-url");
        Settings bounded = Settings.from(invalid);
        check(bounded.volume == 1, "clamp volume");
        check(bounded.intensity == 0, "clamp intensity");
        check(bounded.rate == 16, "nonfinite rate defaults");
        check(Double.isFinite(bounded.ambienceVolume), "finite ambience gain");
        check(bounded.duration == 25, "unsupported timer defaults");
        check(bounded.seed > 0, "reject negative seed");
        check(bounded.style.equals("ambient"), "unknown style defaults");
        check(bounded.mode.equals("focus"), "unknown mode defaults");
        check(bounded.ambience.equals("none"), "unknown ambience defaults");
        check(Settings.from(Map.of("rate", 0)).rate == .25, "minimum rate");
        check(Settings.from(Map.of("rate", 100)).rate == 32, "maximum rate");
        check(Settings.from(Map.of("mode", "sleep")).rate == 1, "sleep rate default");
        check(Settings.from(Map.of("duration", 0)).duration == 0, "unlimited duration");
        check(Settings.from(Map.of("duration", 15.5)).duration == 25, "fractional duration rejected");
        check(Settings.from(Map.of("seed", 1.5)).seed == 73129, "fractional seed rejected");
        SignalGenerator synth = new SignalGenerator(44100, defaults);
        synth.setPlaying(true);
        float[] audio = new float[44100 * 2];
        synth.render(audio, 44100);
        double energy = 0, peak = 0, step = 0;
        for (int i = 0; i < audio.length; i++) {
            check(Float.isFinite(audio[i]), "finite audio");
            energy += audio[i] * audio[i]; peak = Math.max(peak, Math.abs(audio[i]));
            if (i >= 2) step = Math.max(step, Math.abs(audio[i] - audio[i - 2]));
        }
        check(Math.sqrt(energy / audio.length) > .01, "audible RMS");
        check(peak < .9, "safe peak headroom");
        check(step < .15, "gentle sample transitions");
        check(synth.framesGenerated() == 44100, "exact one second of stereo frames");
        SignalGenerator identical = new SignalGenerator(44100, defaults);
        identical.setPlaying(true);
        float[] repeated = new float[audio.length]; identical.render(repeated, 44100);
        check(java.util.Arrays.equals(audio, repeated), "seeded rendering deterministic");
        SignalGenerator other = new SignalGenerator(44100, Settings.from(Map.of("seed", 55)));
        other.setPlaying(true); other.render(repeated, 44100);
        check(!java.util.Arrays.equals(audio, repeated), "seed changes texture");
        SignalGenerator silence = new SignalGenerator(48000, Settings.from(Map.of("volume", 0)));
        silence.setPlaying(true); silence.render(repeated, 44100);
        check(java.util.Arrays.equals(repeated, new float[repeated.length]), "zero volume is silence");
        synth.setPlaying(false); synth.render(repeated, 44100);
        check(Math.abs(repeated[repeated.length - 1]) < 1e-8, "pause fades to silence");
        long[] now = {0};
        SessionClock clock = new SessionClock(() -> now[0]);
        clock.resume(); now[0] = 2_000_000_000L;
        check(clock.seconds() == 2, "clock advances while playing");
        clock.pause(); now[0] = 8_000_000_000L;
        check(clock.seconds() == 2, "pause retains elapsed");
        clock.resume(); now[0] = 9_000_000_000L;
        check(clock.seconds() == 3, "resume continues elapsed");
        clock.reset(); check(clock.seconds() == 0, "stop resets elapsed");
        check(Settings.from(Map.of("rateHz", 7)).rate == 7, "web rateHz alias");
        check(Settings.from(Map.of("seed", 9_007_199_254_740_991L)).seed == 9_007_199_254_740_991L, "safe JS integer seed");
        check(Settings.from(Map.of("duration", -1)).duration == 25, "negative timer must not become unlimited");
        check(Settings.from(Map.of("duration", 100)).duration == 25, "unsupported long timer rejected");
        check(defaults.intensity == .22 && defaults.ambienceVolume == .2, "shared web defaults");
        check(Settings.from(Map.of("mode", "sleep")).style.equals("deep"), "shared sleep palette default");
        Settings noAm = Settings.from(Map.of("intensity", 0, "rate", 1));
        SignalGenerator noAmSlow = new SignalGenerator(44100, noAm);
        SignalGenerator noAmFast = new SignalGenerator(44100, Settings.from(Map.of("intensity", 0, "rate", 32)));
        noAmSlow.setPlaying(true); noAmFast.setPlaying(true);
        noAmSlow.render(audio, 44100); noAmFast.render(repeated, 44100);
        check(java.util.Arrays.equals(audio, repeated), "zero depth removes rate effect");
        double unmodulatedEnergy = energy(audio);
        SignalGenerator am = new SignalGenerator(44100, Settings.from(Map.of("intensity", .6, "rate", 8)));
        am.setPlaying(true); am.render(repeated, 44100);
        check(!java.util.Arrays.equals(audio, repeated), "AM changes actual output");
        check(energy(repeated) < unmodulatedEnergy, "AM attenuates rather than amplifies pads");
        float previousL = repeated[repeated.length - 2], previousR = repeated[repeated.length - 1];
        am.setSettings(Settings.from(Map.of("mode", "sleep", "style", "lofi", "ambience", "rain", "ambienceVolume", 1, "rate", .25, "volume", 1)));
        am.render(repeated, 44100);
        double updateStep = Math.max(Math.abs(previousL - repeated[0]), Math.abs(previousR - repeated[1]));
        for (int i = 0; i < repeated.length; i++) {
            check(Float.isFinite(repeated[i]) && Math.abs(repeated[i]) < .81, "live controls finite and peak bounded");
            if (i >= 2) updateStep = Math.max(updateStep, Math.abs(repeated[i] - repeated[i - 2]));
        }
        check(updateStep < .15, "live mode/style/gain changes remain smooth");
        boolean rejected = false;
        try { synth.render(new float[3], 2); } catch (IllegalArgumentException expected) { rejected = true; }
        check(rejected, "reject undersized stereo buffer");
        System.out.printf(java.util.Locale.ROOT, "Audio metrics: RMS=%.5f peak=%.5f maxStep=%.5f liveMaxStep=%.5f%n", Math.sqrt(energy / audio.length), peak, step, updateStep);
        System.out.println("PASS " + checks + " core assertions");
    }
    private static double energy(float[] samples) {
        double sum = 0; for (float sample : samples) sum += sample * sample; return sum;
    }
}
