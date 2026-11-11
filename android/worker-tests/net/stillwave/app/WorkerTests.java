package net.stillwave.app;
import android.content.Context;
import android.media.AudioTrack;
import java.lang.reflect.Field;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import net.stillwave.audio.Settings;

/** Runs the real, uninstrumented worker against test-only Android platform doubles. */
public final class WorkerTests {
    private static final class Events implements AudioEngine.Listener {
        final Semaphore playing = new Semaphore(0);
        volatile String failure;
        public void onPlaying() { playing.release(); }
        public void onFailure(String message) { failure = message; }
        void awaitPlaying() throws Exception {
            check(playing.tryAcquire(3, TimeUnit.SECONDS), "play request was not acknowledged: " + failure);
        }
    }
    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }
    private static AudioEngine engine(Events events) {
        return new AudioEngine(new Context(), Settings.from(Map.of()), events);
    }
    private static Thread worker(AudioEngine engine) throws Exception {
        Field field = AudioEngine.class.getDeclaredField("worker"); field.setAccessible(true);
        return (Thread) field.get(engine);
    }
    private static void awaitIdle(AudioEngine engine, Events events) throws Exception {
        Thread thread = worker(engine);
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(3);
        while (thread.isAlive() && !isIdle(thread) && System.nanoTime() < deadline) Thread.yield();
        check(events.failure == null, "unexpected audio failure: " + events.failure);
        check(thread.isAlive() && isIdle(thread), "worker did not return to idle");
    }
    private static boolean isIdle(Thread thread) {
        // WAITING alone could still be the construction/write test gate. Require the
        // worker's real monitor.wait, not CountDownLatch's LockSupport.park.
        if (thread.getState() != Thread.State.WAITING) return false;
        for (StackTraceElement frame : thread.getStackTrace()) {
            if (frame.getClassName().equals("java.lang.Object") && frame.getMethodName().equals("wait")) return true;
        }
        return false;
    }
    private static void finish(AudioEngine engine) throws Exception {
        AudioTrack.allowConstruction.countDown(); AudioTrack.onWrite = null;
        engine.close(); worker(engine).join(3000);
        check(!worker(engine).isAlive(), "close did not terminate worker");
        check(AudioTrack.latest.released, "track not released");
        check(!engine.isWakeHeld(), "wake lock leaked");
    }
    private static void pauseDuringCreationThenResume() throws Exception {
        AudioTrack.reset(true); Events events = new Events(); AudioEngine engine = engine(events);
        try {
            engine.play(); AudioTrack.await(AudioTrack.constructing);
            engine.pause(); AudioTrack.allowConstruction.countDown(); awaitIdle(engine, events);
            check(AudioTrack.latest.writes == 0 && AudioTrack.latest.writesBeforePlay == 0, "paused startup wrote before play");
            check(AudioTrack.latest.plays == 0 && !engine.isWakeHeld(), "paused startup started output");
            engine.play(); events.awaitPlaying();
        } finally { finish(engine); }
        check(events.failure == null, "resume failed");
    }
    private static void closeDuringCreation() throws Exception {
        AudioTrack.reset(true); Events events = new Events(); AudioEngine engine = engine(events);
        engine.play(); AudioTrack.await(AudioTrack.constructing); engine.close(); finish(engine);
        check(AudioTrack.latest.plays == 0, "closing startup played");
        check(AudioTrack.latest.writesBeforePlay == 0 && AudioTrack.latest.writes == 0, "closing startup wrote before play");
        check(events.failure == null, "closing startup reported failure");
    }
    private static void normalPauseDrainsAndCleansUp() throws Exception {
        AudioTrack.reset(false); Events events = new Events();
        CountDownLatch writing = new CountDownLatch(1), allowWrite = new CountDownLatch(1);
        AtomicBoolean first = new AtomicBoolean(true);
        AudioTrack.onWrite = () -> { if (first.getAndSet(false)) { writing.countDown(); AudioTrack.await(allowWrite); } };
        AudioEngine engine = engine(events);
        try {
            engine.play(); events.awaitPlaying(); AudioTrack.await(writing);
            engine.pause(); allowWrite.countDown(); awaitIdle(engine, events);
            check(AudioTrack.latest.trailingZeroFrames >= AudioTrack.latest.getBufferSizeInFrames() + 1024, "pause did not drain output buffer with zeros");
            check(AudioTrack.latest.pauses == 1 && AudioTrack.latest.flushes == 1, "pause did not clean output");
            check(!engine.isWakeHeld(), "pause held wake lock");
            check(AudioTrack.latest.writesBeforePlay == 0, "write before play");
        } finally { allowWrite.countDown(); finish(engine); }
    }
    private static void rapidResumeAcknowledgesAgain() throws Exception {
        AudioTrack.reset(false); Events events = new Events();
        CountDownLatch writing = new CountDownLatch(1), allowWrite = new CountDownLatch(1);
        AtomicBoolean first = new AtomicBoolean(true);
        AudioTrack.onWrite = () -> { if (first.getAndSet(false)) { writing.countDown(); AudioTrack.await(allowWrite); } };
        AudioEngine engine = engine(events);
        try {
            engine.play(); events.awaitPlaying(); AudioTrack.await(writing);
            engine.pause(); engine.play(); allowWrite.countDown(); events.awaitPlaying();
            check(AudioTrack.latest.plays == 1, "rapid resume unnecessarily restarted output");
            check(AudioTrack.latest.writesBeforePlay == 0, "write before play");
        } finally { allowWrite.countDown(); finish(engine); }
        check(events.failure == null, "rapid resume failed");
    }
    public static void main(String[] args) throws Exception {
        String[] names = {"pauseDuringCreationThenResume", "closeDuringCreation", "normalPauseDrainsAndCleansUp", "rapidResumeAcknowledgesAgain"};
        int failures = 0;
        for (String name : names) {
            try { WorkerTests.class.getDeclaredMethod(name).invoke(null); System.out.println("PASS " + name); }
            catch (java.lang.reflect.InvocationTargetException error) {
                failures++; System.out.println("FAIL " + name + ": " + error.getCause());
            }
        }
        if (failures > 0) throw new AssertionError(failures + " worker tests failed");
        System.out.println("Worker tests passed (4)");
    }
}
