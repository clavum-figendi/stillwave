#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
APK_DIR=${1:-"$ROOT/android/app/build/outputs/apk"}
LOG_DIR=${STILLWAVE_TEST_LOG_DIR:-"$ROOT/android/build/offline-test"}
mkdir -p "$LOG_DIR"
adb install -r "$APK_DIR/debug/app-debug.apk"
adb install -r "$APK_DIR/androidTest/debug/app-debug-androidTest.apk"
adb shell pm clear net.stillwave.app
API=$(adb shell getprop ro.build.version.sdk | tr -d '\r')
if [ "$API" -ge 33 ]; then
  # Explicit denial, not an accidentally granted permission. MediaSession FGS
  # must work under Android 13+ notification denial without a prompt blocking CI.
  adb shell pm revoke net.stillwave.app android.permission.POST_NOTIFICATIONS
  adb shell pm set-permission-flags net.stillwave.app android.permission.POST_NOTIFICATIONS user-set user-fixed
fi
adb shell settings put global airplane_mode_on 1
adb shell svc wifi disable
adb shell svc data disable
adb shell input keyevent KEYCODE_WAKEUP
adb shell wm dismiss-keyguard
adb logcat -c
set +e
adb shell am instrument -w -r net.stillwave.app.test/net.stillwave.app.OfflineInstrumentation | tee "$LOG_DIR/instrumentation.txt"
INSTRUMENT_EXIT=${PIPESTATUS[0]}
set -e
adb logcat -d > "$LOG_DIR/logcat.txt"
adb shell dumpsys activity services net.stillwave.app > "$LOG_DIR/services.txt"
adb shell dumpsys media_session > "$LOG_DIR/media-session.txt"
adb exec-out screencap -p > "$LOG_DIR/final-screen.png"
python3 - "$LOG_DIR/instrumentation.txt" "$INSTRUMENT_EXIT" <<'PY'
import pathlib, sys
output = pathlib.Path(sys.argv[1]).read_text()
assert sys.argv[2] == '0', 'adb instrumentation command failed'
assert 'INSTRUMENTATION_CODE: -1' in output, 'Instrumentation did not finish successfully'
assert '1 offline integration test passed' in output, 'Missing explicit test completion'
assert 'INSTRUMENTATION_STATUS_CODE: -2' not in output, 'Integration assertion failed'
assert 'INSTRUMENTATION_FAILED' not in output, 'Instrumentation runner failed'
print('PASS: cold airplane-mode UI, ES modules, native AudioTrack, pause/resume/stop, notification, screen-off playback, wake-lock cleanup')
PY
