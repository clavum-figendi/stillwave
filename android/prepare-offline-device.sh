#!/usr/bin/env bash
# Emulator test setup only. Verify connectivity, not the saved mobile-data preference.
set -euo pipefail
API=${1:?Android API level is required}
if ! [[ "$API" =~ ^[0-9]+$ ]]; then printf '%s\n' 'Invalid Android API level' >&2; exit 1; fi
if [ "$API" -lt 29 ]; then
  # Old AVD shell lacks CHANGE_WIFI_STATE. Never attempt adb root on phones.
  test "$(adb shell getprop ro.kernel.qemu | tr -d '\r')" = 1
  timeout 30s adb root
  timeout 30s adb wait-for-device
  test "$(adb shell id -u | tr -d '\r')" = 0
  adb shell settings put global airplane_mode_on 1
  adb shell am broadcast -a android.intent.action.AIRPLANE_MODE --ez state true
else
  # This service command changes airplane mode AND sends its framework broadcast.
  adb shell cmd connectivity airplane-mode enable
fi
adb shell svc wifi disable
adb shell svc data disable
for attempt in 1 2 3 4 5; do
  WIFI=$(adb shell settings get global wifi_on | tr -d '\r')
  PLANE=$(adb shell settings get global airplane_mode_on | tr -d '\r')
  DATA=$(adb shell settings get global mobile_data | tr -d '\r')
  CONNECTIVITY=$(adb shell dumpsys connectivity | tr -d '\r')
  DEFAULT_NONE=false
  while IFS= read -r line; do
    if [[ "$line" =~ ^[[:space:]]*Active[[:space:]]default[[:space:]]network:[[:space:]]none[[:space:]]*$ ]]; then DEFAULT_NONE=true; fi
  done <<< "$CONNECTIVITY"
  if [ "$WIFI" = 0 ] && [ "$PLANE" = 1 ] && [ "$DEFAULT_NONE" = true ]; then
    printf 'OFFLINE_RADIOS_VERIFIED: airplane=1 wifi_on=0 active_default_network=none (saved mobile_data=%s)\n' "$DATA"
    exit 0
  fi
  sleep 1
done
printf 'Offline setup failed: airplane=%s wifi_on=%s mobile_data_preference=%s default_none=%s\n%s\n' "$PLANE" "$WIFI" "$DATA" "$DEFAULT_NONE" "$CONNECTIVITY" >&2
exit 1
