package net.stillwave.app;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.view.WindowInsets;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/** Sandboxed, bundled-only HTTPS origin. No network permission or external intents. */
public final class MainActivity extends Activity {
    static final String HOME = "https://appassets.androidplatform.net/assets/web/index.html";
    private WebView web;
    private final AtomicBoolean trustedDocument = new AtomicBoolean(false);
    private final Handler main = new Handler(Looper.getMainLooper());
    private boolean visible;

    @Override public void onCreate(Bundle savedState) {
        super.onCreate(savedState);
        getWindow().setStatusBarColor(Color.rgb(12, 17, 19));
        getWindow().setNavigationBarColor(Color.rgb(12, 17, 19));
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(12, 17, 19));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setBlockNetworkLoads(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        CookieManager.getInstance().setAcceptCookie(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        web.addJavascriptInterface(new NativeAudio(), "NativeAudio");
        web.setWebChromeClient(new WebChromeClient()); // No file chooser, geolocation, mic or camera grants.
        web.setWebViewClient(new BundledClient());
        setContentView(web);
        // Android 15 enforces edge-to-edge: protect the UI with system/cutout padding.
        if (Build.VERSION.SDK_INT >= 30) {
            web.setOnApplyWindowInsetsListener((view, insets) -> {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                return insets;
            });
        }
        web.loadUrl(HOME);
    }
    @Override protected void onResume() { super.onResume(); visible = true; }
    @Override protected void onPause() { visible = false; super.onPause(); }
    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else moveTaskToBack(true);
    }
    @Override protected void onDestroy() {
        trustedDocument.set(false); main.removeCallbacksAndMessages(null);
        web.removeJavascriptInterface("NativeAudio");
        web.stopLoading(); web.setWebChromeClient(null); web.destroy();
        super.onDestroy();
    }

    static boolean isBundled(Uri uri) {
        if (!"https".equals(uri.getScheme()) || !"appassets.androidplatform.net".equals(uri.getHost())
                || (uri.getPort() != -1 && uri.getPort() != 443) || uri.getUserInfo() != null) return false;
        String path = uri.getPath();
        if (path == null || !path.startsWith("/assets/web/") || path.indexOf('\\') >= 0 || path.indexOf('\0') >= 0) return false;
        for (String segment : path.split("/", -1)) if (segment.equals("..") || segment.equals(".")) return false;
        return true;
    }
    private static boolean isHome(Uri uri) { return isBundled(uri) && "/assets/web/index.html".equals(uri.getPath()); }
    static String mime(String name) {
        String extension = name.substring(name.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
        switch (extension) {
            case "html": return "text/html";
            case "js": case "mjs": return "application/javascript";
            case "css": return "text/css";
            case "json": case "webmanifest": return "application/json";
            case "svg": return "image/svg+xml";
            case "png": return "image/png";
            case "webp": return "image/webp";
            case "jpg": case "jpeg": return "image/jpeg";
            case "ico": return "image/x-icon";
            case "woff": return "font/woff";
            case "woff2": return "font/woff2";
            default: return "application/octet-stream";
        }
    }
    private static WebResourceResponse blocked(int status, String reason) {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store"); headers.put("X-Content-Type-Options", "nosniff");
        return new WebResourceResponse("text/plain", "UTF-8", status, reason, headers,
                new ByteArrayInputStream(reason.getBytes(StandardCharsets.UTF_8)));
    }
    private final class BundledClient extends WebViewClient {
        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return !request.isForMainFrame() || !isHome(request.getUrl());
        }
        @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            trustedDocument.set(isHome(Uri.parse(url)));
        }
        @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!"GET".equals(request.getMethod()) || !isBundled(uri)) return blocked(403, "Blocked");
            String relative = uri.getPath().substring("/assets/web/".length());
            if (relative.isEmpty()) return blocked(404, "Not found");
            Map<String, String> headers = new HashMap<>();
            headers.put("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'");
            headers.put("X-Content-Type-Options", "nosniff"); headers.put("Cache-Control", "no-cache");
            try {
                String type = mime(relative);
                return new WebResourceResponse(type, type.startsWith("text/") || type.equals("application/javascript") || type.equals("application/json") || type.equals("image/svg+xml") ? "UTF-8" : null,
                        200, "OK", headers, getAssets().open("web/" + relative));
            } catch (IOException missing) { return blocked(404, "Not found"); }
        }
    }
    private final class NativeAudio {
        private boolean allowed() { return trustedDocument.get(); }
        @JavascriptInterface public void start(String json) {
            if (!allowed() || json == null || json.length() > 8192) return;
            main.post(() -> {
                if (!allowed() || !visible) return; // FGS starts only from visible, trusted UI or media notification.
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                        && !getPreferences(MODE_PRIVATE).getBoolean("notificationAsked", false)) {
                    getPreferences(MODE_PRIVATE).edit().putBoolean("notificationAsked", true).apply();
                    requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, 7);
                }
                try {
                    startForegroundService(new Intent(MainActivity.this, PlaybackService.class).setAction(PlaybackService.START).putExtra("settings", json));
                } catch (RuntimeException error) { PlaybackService.reportError("Playback could not start. Open the app and try again."); }
            });
        }
        @JavascriptInterface public void pause() {
            if (allowed()) main.post(() -> { if (allowed()) PlaybackService.dispatchIfRunning(PlaybackService.PAUSE, null); });
        }
        @JavascriptInterface public void stop() {
            if (allowed()) main.post(() -> { if (allowed()) PlaybackService.dispatchIfRunning(PlaybackService.STOP, null); });
        }
        @JavascriptInterface public void update(String json) {
            if (allowed() && json != null && json.length() <= 8192) main.post(() -> {
                if (allowed()) PlaybackService.dispatchIfRunning(PlaybackService.UPDATE, json);
            });
        }
        @JavascriptInterface public String getState() { return allowed() ? PlaybackService.stateJson() : "{\"playing\":false,\"elapsed\":0}"; }
    }
}
