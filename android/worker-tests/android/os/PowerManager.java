package android.os;
public class PowerManager {
    public static final int PARTIAL_WAKE_LOCK = 1;
    public WakeLock newWakeLock(int level, String tag) { return new WakeLock(); }
    public static class WakeLock {
        private volatile boolean held;
        public void setReferenceCounted(boolean value) { }
        public void acquire(long timeout) { held = true; }
        public boolean isHeld() { return held; }
        public void release() { held = false; }
    }
}
