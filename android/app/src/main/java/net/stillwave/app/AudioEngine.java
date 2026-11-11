package net.stillwave.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import android.os.PowerManager;
import android.os.Process;
import java.util.Arrays;
import net.stillwave.audio.Settings;
import net.stillwave.audio.SignalGenerator;

/** Single writer owns AudioTrack and DSP. UI never synthesizes or waits for audio. */
final class AudioEngine implements AutoCloseable {
    interface Listener { void onPlaying(); void onFailure(String message); }
    private final Object monitor = new Object();
    private final PowerManager.WakeLock wakeLock;
    private final Listener listener;
    private final Thread worker;
    private volatile boolean desiredPlaying, closing;
    private volatile long playRequest;
    private volatile Settings settings;
    volatile long renderedFrames;
    volatile int sampleRate;
    private volatile boolean wakeHeld;

    AudioEngine(Context context, Settings initial, Listener listener) {
        settings = initial; this.listener = listener;
        wakeLock = context.getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Stillwave:Audio");
        wakeLock.setReferenceCounted(false);
        worker = new Thread(this::run, "Stillwave-Audio"); worker.start();
    }
    void update(Settings settings) { this.settings = settings; }
    void play() { synchronized (monitor) { playRequest++; desiredPlaying = true; monitor.notifyAll(); } }
    void pause() { desiredPlaying = false; }
    boolean isWakeHeld() { return wakeHeld; }
    @Override public void close() {
        synchronized (monitor) { desiredPlaying = false; closing = true; monitor.notifyAll(); }
    }
    private AudioTrack createTrack(int rate) {
        int minimum = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_STEREO, AudioFormat.ENCODING_PCM_FLOAT);
        if (minimum <= 0) throw new IllegalStateException("Unsupported audio output");
        AudioTrack track = new AudioTrack.Builder()
                .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                .setAudioFormat(new AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_FLOAT).setSampleRate(rate).setChannelMask(AudioFormat.CHANNEL_OUT_STEREO).build())
                .setTransferMode(AudioTrack.MODE_STREAM).setBufferSizeInBytes(Math.max(minimum, 1024 * 8 * 3)).build();
        if (track.getState() != AudioTrack.STATE_INITIALIZED) { track.release(); throw new IllegalStateException("Audio output unavailable"); }
        return track;
    }
    private void write(AudioTrack track, float[] buffer, int samples) {
        int offset = 0;
        while (offset < samples) {
            int count = track.write(buffer, offset, samples - offset, AudioTrack.WRITE_BLOCKING);
            if (count <= 0) throw new IllegalStateException("Audio output interrupted (" + count + ")");
            offset += count; renderedFrames += count / 2;
        }
    }
    private void releaseWake() { if (wakeLock.isHeld()) wakeLock.release(); wakeHeld = false; }
    private void run() {
        Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO);
        AudioTrack track = null;
        boolean outputPlaying = false;
        long acknowledgedPlay = -1, renewWakeAt = 0;
        try {
            SignalGenerator synth = null;
            Settings applied = null;
            float[] buffer = new float[2048];
            while (true) {
                if (!desiredPlaying && !outputPlaying) {
                    if (closing) break;
                    synchronized (monitor) { if (!desiredPlaying && !closing) monitor.wait(); }
                    continue;
                }
                if (track == null) {
                    try { track = createTrack(44100); sampleRate = 44100; }
                    catch (RuntimeException unavailable) { track = createTrack(48000); sampleRate = 48000; }
                    synth = new SignalGenerator(sampleRate, settings);
                }
                if (desiredPlaying && !closing) {
                    long now = android.os.SystemClock.elapsedRealtime();
                    if (!wakeHeld || now >= renewWakeAt) {
                        wakeLock.acquire(10 * 60 * 1000L); wakeHeld = true; renewWakeAt = now + 60_000;
                    }
                    if (!outputPlaying) { track.play(); outputPlaying = true; }
                    // A rapid pause/resume can happen before the fade finishes; still
                    // acknowledge each play request so the session clock resumes.
                    long request = playRequest;
                    if (request != acknowledgedPlay) { acknowledgedPlay = request; listener.onPlaying(); }
                }
                // Pause/close can arrive while createTrack is initializing. Never write
                // or drain a track that has not started: blocking writes can stall forever.
                // Already-playing output must still render its fade during pause/close.
                if (!outputPlaying) {
                    if (closing) break;
                    continue;
                }
                Settings next = settings;
                if (next != applied) { synth.setSettings(next); applied = next; }
                synth.setPlaying(desiredPlaying && !closing);
                synth.render(buffer, 1024);
                write(track, buffer, buffer.length);
                if ((!desiredPlaying || closing) && synth.isSilent()) {
                    // Drain the fade before pausing: enqueue more than one output buffer of
                    // zeros. A blocking write guarantees the fade has reached the device.
                    Arrays.fill(buffer, 0);
                    int remaining = track.getBufferSizeInFrames() + 1024;
                    while (remaining > 0) {
                        int frames = Math.min(1024, remaining); write(track, buffer, frames * 2); remaining -= frames;
                    }
                    track.pause(); track.flush(); outputPlaying = false; releaseWake();
                    if (closing) break;
                }
            }
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        } catch (RuntimeException failure) {
            listener.onFailure("Audio output unavailable. Pause other audio apps and try again.");
        } finally {
            if (track != null) {
                try { track.pause(); track.flush(); } catch (IllegalStateException ignored) { }
                track.release();
            }
            releaseWake();
        }
    }
}
