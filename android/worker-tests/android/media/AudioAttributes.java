package android.media;
public class AudioAttributes {
    public static final int USAGE_MEDIA = 1, CONTENT_TYPE_MUSIC = 2;
    public static class Builder {
        public Builder setUsage(int value) { return this; }
        public Builder setContentType(int value) { return this; }
        public AudioAttributes build() { return new AudioAttributes(); }
    }
}
