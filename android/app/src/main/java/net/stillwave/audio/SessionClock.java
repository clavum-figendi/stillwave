package net.stillwave.audio;

import java.util.function.LongSupplier;

/** Monotonic, thread-safe elapsed time; no wall clock changes or paused time. */
public final class SessionClock {
    private final LongSupplier nanos;
    private long accumulated, started;
    private boolean playing;
    public SessionClock() { this(System::nanoTime); }
    public SessionClock(LongSupplier nanos) { this.nanos = nanos; }
    public synchronized void resume() {
        if (!playing) { started = nanos.getAsLong(); playing = true; }
    }
    public synchronized void pause() {
        if (playing) { accumulated += Math.max(0, nanos.getAsLong() - started); playing = false; }
    }
    public synchronized void reset() { accumulated = 0; playing = false; }
    public synchronized boolean isPlaying() { return playing; }
    public synchronized double seconds() {
        return (accumulated + (playing ? Math.max(0, nanos.getAsLong() - started) : 0)) / 1_000_000_000.0;
    }
}
