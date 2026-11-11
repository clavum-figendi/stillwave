package net.stillwave.audio;

import java.util.HashMap;
import java.util.Map;

/** Immutable, validated DSP controls. No Android dependencies. */
public final class Settings {
    public final String mode, style, ambience;
    public final double volume, intensity, rate, ambienceVolume;
    public final int duration;
    public final long seed;

    private Settings(Map<String, ?> values) {
        mode = choice(values.get("mode"), "focus", "focus", "relax", "sleep", "meditate");
        style = choice(values.get("style"), mode.equals("sleep") ? "deep" : "ambient", "ambient", "lofi", "deep");
        ambience = choice(values.get("ambience"), "none", "none", "rain", "brown");
        volume = number(values.get("volume"), .55, 0, 1);
        double defaultIntensity = mode.equals("relax") ? .16 : mode.equals("sleep") ? .12 : mode.equals("meditate") ? .18 : .22;
        intensity = number(values.get("intensity"), defaultIntensity, 0, .6);
        double defaultRate = mode.equals("relax") ? 8 : mode.equals("sleep") ? 1 : mode.equals("meditate") ? 6 : 16;
        rate = number(values.containsKey("rateHz") ? values.get("rateHz") : values.get("rate"), defaultRate, .25, 32);
        ambienceVolume = number(values.get("ambienceVolume"), .2, 0, 1);
        double minutes = number(values.get("duration"), 25, -Double.MAX_VALUE, Double.MAX_VALUE);
        duration = minutes == 0 || minutes == 15 || minutes == 25 || minutes == 45 || minutes == 60 || minutes == 90 ? (int) minutes : 25;
        double rawSeed = number(values.get("seed"), 73129, -Double.MAX_VALUE, Double.MAX_VALUE);
        seed = rawSeed >= 1 && rawSeed <= 9_007_199_254_740_991L && rawSeed == Math.rint(rawSeed) ? (long) rawSeed : 73129;
    }

    public static Settings from(Map<String, ?> values) { return new Settings(values); }

    private static double number(Object value, double fallback, double low, double high) {
        if (!(value instanceof Number)) return fallback;
        double number = ((Number) value).doubleValue();
        return Double.isFinite(number) ? Math.max(low, Math.min(high, number)) : fallback;
    }

    private static String choice(Object value, String fallback, String... choices) {
        for (String candidate : choices) if (candidate.equals(value)) return candidate;
        return fallback;
    }

    public Map<String, Object> toMap() {
        Map<String, Object> values = new HashMap<>();
        values.put("mode", mode); values.put("style", style); values.put("ambience", ambience);
        values.put("volume", volume); values.put("intensity", intensity); values.put("rate", rate);
        values.put("ambienceVolume", ambienceVolume); values.put("duration", duration); values.put("seed", seed);
        return values;
    }
}
