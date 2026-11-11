package android.content;
import android.os.PowerManager;
public class Context {
    private final PowerManager power = new PowerManager();
    public <T> T getSystemService(Class<T> type) { return type.cast(power); }
}
