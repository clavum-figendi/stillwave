package android.media;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
/** Test-only platform double: gates initialization and detects unsafe blocking writes. */
public class AudioTrack {
    public static final int MODE_STREAM = 1, STATE_INITIALIZED = 1, WRITE_BLOCKING = 0;
    public static volatile CountDownLatch constructing, allowConstruction;
    public static volatile Runnable onWrite;
    public static volatile AudioTrack latest;
    public volatile boolean playing, released;
    public volatile int plays, writes, writesBeforePlay, pauses, flushes, frames, trailingZeroFrames;
    public static void reset(boolean gateCreation) {
        constructing = new CountDownLatch(1);
        allowConstruction = new CountDownLatch(gateCreation ? 1 : 0);
        onWrite = null; latest = null;
    }
    public static void await(CountDownLatch latch) {
        try {
            if (!latch.await(3, TimeUnit.SECONDS)) throw new AssertionError("Timed out at test gate");
        } catch (InterruptedException error) { throw new AssertionError(error); }
    }
    public static int getMinBufferSize(int rate, int channels, int encoding) { return 24576; }
    public int getState() { return STATE_INITIALIZED; }
    public int getBufferSizeInFrames() { return 3072; }
    public void play() { playing = true; plays++; }
    public int write(float[] data, int offset, int count, int mode) {
        if (!playing) { writesBeforePlay++; throw new IllegalStateException("write before play"); }
        Runnable hook = onWrite;
        if (hook != null) hook.run();
        boolean zero = true;
        for (int i = offset; i < offset + count; i++) if (data[i] != 0) { zero = false; break; }
        trailingZeroFrames = zero ? trailingZeroFrames + count / 2 : 0;
        writes++; frames += count / 2;
        return count;
    }
    public void pause() { playing = false; pauses++; }
    public void flush() { flushes++; }
    public void release() { released = true; }
    public static class Builder {
        public Builder setAudioAttributes(AudioAttributes value) { return this; }
        public Builder setAudioFormat(AudioFormat value) { return this; }
        public Builder setTransferMode(int value) { return this; }
        public Builder setBufferSizeInBytes(int value) { return this; }
        public AudioTrack build() {
            AudioTrack track = new AudioTrack(); latest = track;
            constructing.countDown(); await(allowConstruction);
            return track;
        }
    }
}
