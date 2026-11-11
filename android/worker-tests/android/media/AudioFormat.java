package android.media;
public class AudioFormat {
    public static final int CHANNEL_OUT_STEREO = 12, ENCODING_PCM_FLOAT = 4;
    public static class Builder {
        public Builder setEncoding(int value) { return this; }
        public Builder setSampleRate(int value) { return this; }
        public Builder setChannelMask(int value) { return this; }
        public AudioFormat build() { return new AudioFormat(); }
    }
}
