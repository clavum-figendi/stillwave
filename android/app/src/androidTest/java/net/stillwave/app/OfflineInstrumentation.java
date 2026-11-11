package net.stillwave.app;

import android.app.Activity;
import android.app.Instrumentation;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.ViewGroup;
import android.webkit.WebView;
import org.json.JSONObject;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** No test libraries or network: exercised on an airplane-mode emulator by CI. */
public final class OfflineInstrumentation extends Instrumentation {
    private int completed;
    @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); start(); }
    @Override public void onStart() {
        super.onStart();
        Bundle result = new Bundle();
        try {
            runCase("coldOfflineLaunch", this::coldOfflineLaunch);
            result.putString("stream", "Stillwave: " + completed + " offline integration test passed\n");
            finish(Activity.RESULT_OK, result);
        } catch (Throwable error) {
            result.putString("stream", android.util.Log.getStackTraceString(error));
            finish(Activity.RESULT_CANCELED, result);
        }
    }
    private void runCase(String name, ThrowingRunnable test) throws Exception {
        Bundle status = new Bundle(); status.putString("id", "Stillwave"); status.putInt("numtests", 1);
        status.putInt("current", 1); status.putString("class", getClass().getName()); status.putString("test", name);
        sendStatus(1, status);
        try { test.run(); completed++; sendStatus(0, status); }
        catch (Throwable failure) {
            status.putString("stack", android.util.Log.getStackTraceString(failure)); sendStatus(-2, status);
            throw new AssertionError(failure);
        }
    }
    private interface ThrowingRunnable { void run() throws Exception; }
    private static void require(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
    private void coldOfflineLaunch() throws Exception {
        require(MainActivity.isBundled(android.net.Uri.parse(MainActivity.HOME)), "Accept bundled HTTPS origin");
        for (String url : new String[] {"file:///data/data/net.stillwave.app/secret", "content://media/secret", "https://example.com/assets/web/index.html", "https://appassets.androidplatform.net.evil/assets/web/index.html", "https://appassets.androidplatform.net/assets/web/%2e%2e/secret", "https://appassets.androidplatform.net:444/assets/web/index.html", "https://evil@appassets.androidplatform.net/assets/web/index.html"}) {
            require(!MainActivity.isBundled(android.net.Uri.parse(url)), "Reject untrusted path: " + url);
        }
        require(MainActivity.mime("js/app.js").equals("application/javascript"), "ES module MIME");
        PackageInfo info = getTargetContext().getPackageManager().getPackageInfo("net.stillwave.app", 4096);
        for (String permission : info.requestedPermissions) require(!permission.equals("android.permission.INTERNET"), "No INTERNET permission");
        require(android.provider.Settings.Global.getInt(getTargetContext().getContentResolver(), "airplane_mode_on", 0) == 1, "CI must enable airplane mode");
        Activity activity = startActivitySync(new Intent(getTargetContext(), MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        AtomicReference<WebView> view = new AtomicReference<>();
        runOnMainSync(() -> view.set((WebView) ((ViewGroup) activity.findViewById(android.R.id.content)).getChildAt(0)));
        WebView web = view.get();
        long deadline = SystemClock.elapsedRealtime() + 30000;
        // about:blank can initially report complete before loadUrl commits. Wait
        // for the actual bundled URL and initialized player, not that first state.
        String initialized = "location.href==='" + MainActivity.HOME + "' && document.readyState==='complete' && window.__stillwaveReady===true && !document.getElementById('playButton').disabled && document.getElementById('offlineStatus').textContent.indexOf('Bundled')>=0";
        while (!"true".equals(evaluate(web, initialized)) && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(100);
        if (!"true".equals(evaluate(web, initialized))) {
            throw new AssertionError("Bundled JavaScript initialized the live UI offline: " + evaluate(web, "location.href"));
        }
        require("true".equals(evaluate(web, "location.origin==='https://appassets.androidplatform.net' && typeof NativeAudio==='object' && document.querySelectorAll('button').length>0")), "Offline UI and bridge present");
        require("true".equals(evaluate(web, "Array.prototype.every.call(document.querySelectorAll('script[src]'),function(script){return script.src.indexOf(location.origin+'/assets/web/')===0;})")), "Every script is bundled on the trusted origin");
        // Exercise the real DOM event handlers through the bridge into the service.
        evaluate(web, "document.getElementById('duration').value='0'; document.getElementById('duration').dispatchEvent(new Event('change')); document.getElementById('volume').value='0.25'; document.getElementById('volume').dispatchEvent(new Event('input')); document.getElementById('playButton').click(); true");
        deadline = SystemClock.elapsedRealtime() + 8000;
        while (!new JSONObject(PlaybackService.stateJson()).optBoolean("playing") && SystemClock.elapsedRealtime() < deadline) SystemClock.sleep(100);
        SystemClock.sleep(1200);
        JSONObject playing = new JSONObject(PlaybackService.stateJson());
        require(playing.getBoolean("playing") && !playing.has("error"), "Native playback started: " + playing);
        require(playing.getDouble("elapsed") > .5 && playing.getLong("renderedFrames") > 0, "AudioTrack worker produced audio");
        require(getTargetContext().getSystemService(NotificationManager.class).getActiveNotifications().length > 0, "Media notification exists");
        evaluate(web, "NativeAudio.pause(); true"); SystemClock.sleep(400);
        JSONObject paused = new JSONObject(PlaybackService.stateJson());
        require(!paused.getBoolean("playing"), "Pause bridge");
        SystemClock.sleep(700);
        require(Math.abs(new JSONObject(PlaybackService.stateJson()).getDouble("elapsed") - paused.getDouble("elapsed")) < .03, "Paused clock frozen");
        evaluate(web, "NativeAudio.start('{}'); true"); SystemClock.sleep(500);
        require(new JSONObject(PlaybackService.stateJson()).getDouble("elapsed") > paused.getDouble("elapsed"), "Resume retains elapsed");
        // Exercise the real immutable notification PendingIntents, not just a bridge stub.
        android.service.notification.StatusBarNotification[] notices = getTargetContext().getSystemService(NotificationManager.class).getActiveNotifications();
        notices[0].getNotification().actions[0].actionIntent.send(); SystemClock.sleep(400);
        require(!new JSONObject(PlaybackService.stateJson()).getBoolean("playing"), "Notification pause control");
        notices = getTargetContext().getSystemService(NotificationManager.class).getActiveNotifications();
        notices[0].getNotification().actions[0].actionIntent.send(); SystemClock.sleep(500);
        require(new JSONObject(PlaybackService.stateJson()).getBoolean("playing"), "Notification play control");
        if (android.os.Build.VERSION.SDK_INT >= 33) require(getTargetContext().checkSelfPermission("android.permission.POST_NOTIFICATIONS") != android.content.pm.PackageManager.PERMISSION_GRANTED, "Playback works with notifications denied");
        evaluate(web, "NativeAudio.pause(); NativeAudio.start('{}'); true"); SystemClock.sleep(400);
        require(new JSONObject(PlaybackService.stateJson()).getBoolean("playing"), "Rapid pause/resume clock acknowledges play");
        long before = new JSONObject(PlaybackService.stateJson()).getLong("renderedFrames");
        runOnMainSync(() -> activity.moveTaskToBack(true));
        getUiAutomation().executeShellCommand("input keyevent KEYCODE_SLEEP").close();
        SystemClock.sleep(2200);
        JSONObject background = new JSONObject(PlaybackService.stateJson());
        require(background.getBoolean("playing") && background.getLong("renderedFrames") > before + 44100, "Screen-off native playback continues");
        require(background.optBoolean("wakeLockHeld"), "Partial wake lock held while playing");
        runOnMainSync(() -> PlaybackService.dispatchIfRunning(PlaybackService.PAUSE, null));
        SystemClock.sleep(600);
        require(!new JSONObject(PlaybackService.stateJson()).optBoolean("wakeLockHeld"), "Pause releases wake lock");
        getTargetContext().getSystemService(NotificationManager.class).getActiveNotifications()[0].getNotification().actions[1].actionIntent.send();
        SystemClock.sleep(500);
        JSONObject stopped = new JSONObject(PlaybackService.stateJson());
        require(!stopped.getBoolean("playing") && stopped.getDouble("elapsed") == 0, "Stop resets session");
        require(getTargetContext().getSystemService(NotificationManager.class).getActiveNotifications().length == 0, "Stop removes notification");
        runOnMainSync(activity::finish);
    }
    // Pure Java policy: submission and stack collection share the same total budget.
    static final class CallbackDeadline {
        final long started;
        CallbackDeadline(long started) { this.started = started; }
        long remainingMillis(long now, long budget) {
            return Math.max(0, budget - (now - started));
        }
    }
    private static final String PROBE_TAG = "StillwaveJsProbe";
    private static void dumpJavaThreads(String description) {
        android.util.Log.e(PROBE_TAG, "phase=thread-dump script=" + description);
        // Includes main and JavaBridge even when neither is making progress.
        for (java.util.Map.Entry<Thread, StackTraceElement[]> entry : Thread.getAllStackTraces().entrySet()) {
            Thread thread = entry.getKey();
            android.util.Log.e(PROBE_TAG, "thread=" + thread.getName() + " id=" + thread.getId() + " state=" + thread.getState());
            for (StackTraceElement frame : entry.getValue()) android.util.Log.e(PROBE_TAG, "    at " + frame);
        }
    }
    private String evaluate(WebView view, String script) throws Exception {
        CallbackDeadline deadline = new CallbackDeadline(SystemClock.elapsedRealtime());
        String description = script.replace('\n', ' ').replace('\r', ' ');
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> value = new AtomicReference<>();
        AtomicReference<Throwable> submissionFailure = new AtomicReference<>();
        java.util.concurrent.atomic.AtomicLong callbackAt = new java.util.concurrent.atomic.AtomicLong(-1);
        android.util.Log.i(PROBE_TAG, "phase=enqueue elapsedMs=0 script=" + description);
        // Do not block in runOnMainSync: main-thread queue latency must also be
        // observable and bounded, rather than hiding before the callback wait.
        boolean posted = new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> {
            android.util.Log.i(PROBE_TAG, "phase=submitted elapsedMs=" + (SystemClock.elapsedRealtime() - deadline.started) + " script=" + description);
            try {
                view.evaluateJavascript(script, result -> {
                    long now = SystemClock.elapsedRealtime();
                    value.set(result);
                    callbackAt.set(now);
                    android.util.Log.i(PROBE_TAG, "phase=callback elapsedMs=" + (now - deadline.started) + " late=" + (now - deadline.started > 5000) + " script=" + description);
                    latch.countDown();
                });
                android.util.Log.i(PROBE_TAG, "phase=submit-returned elapsedMs=" + (SystemClock.elapsedRealtime() - deadline.started) + " script=" + description);
            } catch (Throwable error) {
                submissionFailure.set(error);
                latch.countDown();
            }
        });
        require(posted, "Could not enqueue JavaScript: " + description);
        boolean complete = latch.await(deadline.remainingMillis(SystemClock.elapsedRealtime(), 5000), TimeUnit.MILLISECONDS);
        if (!complete) {
            android.util.Log.e(PROBE_TAG, "phase=diagnostic-threshold elapsedMs=" + (SystemClock.elapsedRealtime() - deadline.started) + " script=" + description);
            dumpJavaThreads(description); // Capture before finish() can tear down the process.
            complete = latch.await(deadline.remainingMillis(SystemClock.elapsedRealtime(), 30000), TimeUnit.MILLISECONDS);
        }
        if (submissionFailure.get() != null) throw new AssertionError("JavaScript submission failed: " + description, submissionFailure.get());
        boolean inBudget = complete && callbackAt.get() >= 0 && callbackAt.get() - deadline.started <= 30000;
        if (!inBudget) android.util.Log.e(PROBE_TAG, "phase=timeout elapsedMs=" + (SystemClock.elapsedRealtime() - deadline.started) + " script=" + description);
        require(inBudget, "JavaScript callback timed out (30000ms total): " + description);
        return value.get();
    }
}
