#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
APK_DIR=${1:-"$ROOT/android/app/build/outputs/apk"}
LOG_DIR=${STILLWAVE_TEST_LOG_DIR:-"$ROOT/android/build/offline-test"}
mkdir -p "$LOG_DIR"
# Always retain diagnostics, including failures before instrumentation starts.
collect_diagnostics() {
  adb logcat -d > "$LOG_DIR/logcat.txt" 2>&1 || true
  adb shell dumpsys activity services net.stillwave.app > "$LOG_DIR/services.txt" 2>&1 || true
  adb shell dumpsys media_session > "$LOG_DIR/media-session.txt" 2>&1 || true
  adb exec-out screencap -p > "$LOG_DIR/final-screen.png" 2>/dev/null || true
}
trap collect_diagnostics EXIT
set -x
timeout 120s adb install --no-streaming -r "$APK_DIR/debug/app-debug.apk"
timeout 120s adb install --no-streaming -r "$APK_DIR/androidTest/debug/app-debug-androidTest.apk"
adb shell pm clear net.stillwave.app
API=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
if [ "$API" -ge 33 ]; then
  # Explicit denial, not an accidentally granted permission. MediaSession FGS
  # must work under Android 13+ notification denial without a prompt blocking CI.
  adb shell pm revoke net.stillwave.app android.permission.POST_NOTIFICATIONS
  adb shell pm set-permission-flags net.stillwave.app android.permission.POST_NOTIFICATIONS user-set user-fixed
fi
bash "$ROOT/android/prepare-offline-device.sh" "$API"
adb shell input keyevent KEYCODE_WAKEUP
adb shell wm dismiss-keyguard
adb logcat -c
set +e
timeout 240s adb shell am instrument -w -r net.stillwave.app.test/net.stillwave.app.OfflineInstrumentation | tee "$LOG_DIR/instrumentation.txt"
INSTRUMENT_STATUS=("${PIPESTATUS[@]}")
INSTRUMENT_EXIT=${INSTRUMENT_STATUS[0]}
TEE_EXIT=${INSTRUMENT_STATUS[1]}
set -e
adb logcat -d > "$LOG_DIR/logcat.txt"
adb shell dumpsys activity services net.stillwave.app > "$LOG_DIR/services.txt"
adb shell dumpsys media_session > "$LOG_DIR/media-session.txt"
adb exec-out screencap -p > "$LOG_DIR/final-screen.png"
python3 - "$LOG_DIR/instrumentation.txt" "$INSTRUMENT_EXIT" "$TEE_EXIT" <<'PY'
import pathlib, sys
output = pathlib.Path(sys.argv[1]).read_text()
assert sys.argv[2] == '0', 'adb instrumentation command failed'
assert sys.argv[3] == '0', 'Could not retain instrumentation output'
assert 'INSTRUMENTATION_CODE: -1' in output, 'Instrumentation did not finish successfully'
assert '1 offline integration test passed' in output, 'Missing explicit test completion'
assert 'INSTRUMENTATION_STATUS_CODE: -2' not in output, 'Integration assertion failed'
assert 'INSTRUMENTATION_FAILED' not in output, 'Instrumentation runner failed'
print('PASS: cold airplane-mode UI, ES modules, native AudioTrack, pause/resume/stop, notification, screen-off playback, wake-lock cleanup')
PY
