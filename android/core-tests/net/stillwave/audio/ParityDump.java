package net.stillwave.audio;

import java.io.DataOutputStream;
import java.io.FileOutputStream;
import java.util.HashMap;
import java.util.Map;

/** Renders settings given as key=value pairs to little-endian float32 for tests/parity.test.mjs. */
public final class ParityDump {
    public static void main(String[] args) throws Exception {
        Map<String, Object> values = new HashMap<>();
        for (int i = 3; i < args.length; i++) {
            String[] pair = args[i].split("=", 2);
            try { values.put(pair[0], Double.parseDouble(pair[1])); } catch (NumberFormatException text) { values.put(pair[0], pair[1]); }
        }
        int rate = Integer.parseInt(args[1]), frames = (int) (rate * Double.parseDouble(args[2]));
        SignalGenerator generator = new SignalGenerator(rate, Settings.from(values));
        generator.setPlaying(true);
        float[] audio = new float[frames * 2];
        for (int at = 0; at < frames; at += 1024) {
            int count = Math.min(1024, frames - at);
            float[] block = new float[count * 2];
            generator.render(block, count);
            System.arraycopy(block, 0, audio, at * 2, count * 2);
        }
        try (DataOutputStream out = new DataOutputStream(new FileOutputStream(args[0]))) {
            byte[] bytes = new byte[audio.length * 4];
            for (int i = 0; i < audio.length; i++) { int bits = Float.floatToIntBits(audio[i]); bytes[i * 4] = (byte) bits; bytes[i * 4 + 1] = (byte) (bits >> 8); bytes[i * 4 + 2] = (byte) (bits >> 16); bytes[i * 4 + 3] = (byte) (bits >> 24); }
            out.write(bytes);
        }
    }
}
