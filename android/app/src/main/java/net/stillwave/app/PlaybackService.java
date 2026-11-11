package net.stillwave.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.Iterator;
import java.util.Map;
import net.stillwave.audio.SessionClock;
import net.stillwave.audio.Settings;

/** Native playback outlives the Activity/WebView and runs with the screen off. */
public final class PlaybackService extends Service {
    public static final String START = "net.stillwave.START", PAUSE = "net.stillwave.PAUSE", STOP = "net.stillwave.STOP", UPDATE = "net.stillwave.UPDATE";
    private static final String CHANNEL = "stillwave-playback";
    private static final int NOTIFICATION = 71;
    private static final SessionClock CLOCK = new SessionClock();
    private static volatile PlaybackService instance;
    private static volatile Settings controls = Settings.from(java.util.Collections.emptyMap());
    private static volatile String error;
    private final Handler main = new Handler(Looper.getMainLooper());
    private volatile AudioEngine engine;
    private MediaSession session;
    private AudioManager audioManager;
    private AudioFocusRequest focusRequest;
    private boolean requestedPlaying, foreground, receiverRegistered, destroyed;

    public static String stateJson() {
        JSONObject state = new JSONObject();
        PlaybackService service = instance;
        AudioEngine audio = service == null ? null : service.engine;
        try {
            synchronized (CLOCK) {
                state.put("playing", CLOCK.isPlaying()); state.put("elapsed", CLOCK.seconds());
            }
            state.put("renderedFrames", audio == null ? 0 : audio.renderedFrames);
            state.put("sampleRate", audio == null ? 0 : audio.sampleRate);
            state.put("wakeLockHeld", audio != null && audio.isWakeHeld());
            String problem = error; if (problem != null) state.put("error", problem);
        } catch (JSONException impossible) { return "{\"playing\":false,\"elapsed\":0,\"error\":\"State unavailable\"}"; }
        return state.toString();
    }
    static void reportError(String message) { error = message; }
    /** Called only on the main thread; never starts an unwanted background service. */
    public static void dispatchIfRunning(String action, String json) {
        PlaybackService service = instance;
        if (service != null && !service.destroyed) service.command(action, json);
        else if (STOP.equals(action)) { CLOCK.reset(); error = null; }
    }
    private Settings decode(String json) throws JSONException {
        if (json == null) return controls;
        if (json.length() > 8192) throw new JSONException("Settings too long");
        JSONObject object = new JSONObject(json);
        Map<String, Object> values = controls.toMap();
        // If a mode-only change is sent, adopt that mode's default rate.
        if (object.has("mode") && !object.has("rate") && !object.has("rateHz") && !controls.mode.equals(object.optString("mode"))) values.remove("rate");
        Iterator<String> keys = object.keys();
        while (keys.hasNext()) { String key = keys.next(); values.put(key, object.get(key)); }
        return Settings.from(values);
    }
    @Override public void onCreate() {
        super.onCreate(); instance = this;
        getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel(CHANNEL, "Stillwave playback", NotificationManager.IMPORTANCE_LOW));
        audioManager = getSystemService(AudioManager.class);
        AudioAttributes attributes = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build();
        focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN).setAudioAttributes(attributes)
                .setWillPauseWhenDucked(true).setAcceptsDelayedFocusGain(false)
                .setOnAudioFocusChangeListener(change -> {
                    if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) pausePlayback();
                }, main).build();
        session = new MediaSession(this, "Stillwave");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { command(START, null); }
            @Override public void onPause() { command(PAUSE, null); }
            @Override public void onStop() { command(STOP, null); }
        }, main);
        session.setMetadata(new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, "Stillwave")
                .putString(MediaMetadata.METADATA_KEY_ARTIST, "Offline soundscape").build());
        session.setActive(true);
        IntentFilter filter = new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY);
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(noisy, filter, Context.RECEIVER_NOT_EXPORTED);
        else registerReceiver(noisy, filter);
        receiverRegistered = true;
        main.post(tick);
    }
    private final BroadcastReceiver noisy = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (AudioManager.ACTION_AUDIO_BECOMING_NOISY.equals(intent.getAction())) pausePlayback();
        }
    };
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (destroyed) return;
            if (CLOCK.isPlaying() && controls.duration != 0 && CLOCK.seconds() >= controls.duration * 60.0) {
                command(STOP, null); return;
            }
            if (session != null) updateMediaState();
            main.postDelayed(this, 500);
        }
    };
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        // Do not silently restart audio after process death or reboot.
        if (intent == null) { stopSelf(); return START_NOT_STICKY; }
        String action = intent.getAction();
        if (START.equals(action)) {
            // Must enter FGS promptly, before requesting audio focus (required on Android 15).
            try { enterForeground(); }
            catch (RuntimeException forbidden) { reportError("Playback could not enter foreground. Open the app and try again."); stopSelf(); return START_NOT_STICKY; }
        }
        command(action, intent.getStringExtra("settings"));
        return START_NOT_STICKY;
    }
    private void command(String action, String json) {
        if (destroyed) return;
        if (START.equals(action) || UPDATE.equals(action)) {
            try { controls = decode(json); error = null; }
            catch (JSONException invalid) {
                reportError("Invalid playback settings.");
                if (START.equals(action) && !requestedPlaying) stopServiceCleanly(false);
                return;
            }
            if (engine != null) engine.update(controls);
        }
        if (START.equals(action)) {
            try { enterForeground(); }
            catch (RuntimeException forbidden) { reportError("Playback unavailable in background. Open the app and try again."); stopServiceCleanly(false); return; }
            if (audioManager.requestAudioFocus(focusRequest) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
                reportError("Another app is using audio. Try again when it has finished.");
                stopServiceCleanly(false); return;
            }
            requestedPlaying = true;
            if (engine == null) engine = new AudioEngine(this, controls, new AudioEngine.Listener() {
                @Override public void onPlaying() { main.post(() -> {
                    if (!destroyed && instance == PlaybackService.this && requestedPlaying) {
                        CLOCK.resume(); updateMediaState(); refreshNotification();
                    }
                }); }
                @Override public void onFailure(String message) { main.post(() -> {
                    if (!destroyed && instance == PlaybackService.this) { reportError(message); stopServiceCleanly(false); }
                }); }
            });
            engine.play(); updateMediaState(); refreshNotification();
        } else if (PAUSE.equals(action)) pausePlayback();
        else if (STOP.equals(action)) { error = null; stopServiceCleanly(true); }
    }
    private void pausePlayback() {
        requestedPlaying = false; CLOCK.pause();
        if (engine != null) engine.pause();
        if (audioManager != null && focusRequest != null) audioManager.abandonAudioFocusRequest(focusRequest);
        if (session != null) { updateMediaState(); if (foreground) refreshNotification(); }
    }
    private void stopServiceCleanly(boolean reset) {
        pausePlayback();
        if (reset) CLOCK.reset();
        if (engine != null) { engine.close(); engine = null; }
        if (foreground) { stopForeground(STOP_FOREGROUND_REMOVE); foreground = false; }
        getSystemService(NotificationManager.class).cancel(NOTIFICATION);
        stopSelf();
    }
    private PendingIntent control(String action, int requestCode) {
        Intent intent = new Intent(this, PlaybackService.class).setAction(action);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        return START.equals(action) ? PendingIntent.getForegroundService(this, requestCode, intent, flags) : PendingIntent.getService(this, requestCode, intent, flags);
    }
    private Notification notification() {
        boolean playing = requestedPlaying;
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_wave)
                .setContentTitle("Stillwave").setContentText(playing ? "Offline soundscape · " + controls.mode : "Paused · tap play to resume")
                .setContentIntent(open).setVisibility(Notification.VISIBILITY_PUBLIC).setCategory(Notification.CATEGORY_TRANSPORT)
                .setOngoing(playing).setOnlyAlertOnce(true).setShowWhen(false)
                .setDeleteIntent(control(STOP, 3))
                .addAction(new Notification.Action.Builder(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play, playing ? "Pause" : "Play", control(playing ? PAUSE : START, 1)).build())
                .addAction(new Notification.Action.Builder(android.R.drawable.ic_menu_close_clear_cancel, "Stop", control(STOP, 2)).build())
                .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1)).build();
    }
    private void enterForeground() {
        Notification notification = notification();
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(NOTIFICATION, notification);
        foreground = true;
    }
    private void refreshNotification() {
        // MediaSession notifications are exempt from Android 13 notification denial.
        // startForeground is still mandatory even when the notification drawer hides them.
        if (foreground) getSystemService(NotificationManager.class).notify(NOTIFICATION, notification());
    }
    private void updateMediaState() {
        session.setPlaybackState(new PlaybackState.Builder()
                .setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_STOP)
                .setState(CLOCK.isPlaying() ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, (long) (CLOCK.seconds() * 1000), CLOCK.isPlaying() ? 1 : 0).build());
    }
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onDestroy() {
        destroyed = true; requestedPlaying = false; CLOCK.pause();
        main.removeCallbacksAndMessages(null);
        if (engine != null) { engine.close(); engine = null; }
        if (receiverRegistered) { unregisterReceiver(noisy); receiverRegistered = false; }
        if (audioManager != null && focusRequest != null) audioManager.abandonAudioFocusRequest(focusRequest);
        if (session != null) { session.setActive(false); session.release(); session = null; }
        if (foreground) { stopForeground(STOP_FOREGROUND_REMOVE); foreground = false; }
        getSystemService(NotificationManager.class).cancel(NOTIFICATION);
        if (instance == this) instance = null;
        super.onDestroy();
    }
}
