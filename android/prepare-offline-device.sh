#!/usr/bin/env bash
# Emulator test setup only. Radio state is checked, never inferred from exit zero.
set -euo pipefail
API=${1:?Android API level is required}
if ! [[ "$API" =~ ^[0-9]+$ ]]; then printf '%s\n' 'Invalid Android API level' >&2; exit 1; fi
if [ "$API" -lt 28 ]; then
  # Old AVD shell lacks CHANGE_WIFI_STATE; svc aborts with SecurityException/137.
  # Root is available on google_apis test images, but never attempt it on phones.
  test "$(adb shell getprop ro.kernel.qemu | tr -d '\r')" = 1
  adb root
  adb wait-for-device
  test "$(adb shell id -u | tr -d '\r')" = 0
fi
adb shell settings put global airplane_mode_on 1
adb shell svc wifi disable
adb shell svc data disable
for attempt in 1 2 3 4 5; do
  WIFI=$(adb shell settings get global wifi_on | tr -d '\r')
  DATA=$(adb shell settings get global mobile_data | tr -d '\r')
  if [ "$WIFI" = 0 ] && [ "$DATA" = 0 ]; then
    printf '%s\n' 'OFFLINE_RADIOS_VERIFIED: Wi-Fi and mobile data disabled'
    exit 0
  fi
  sleep 1
done
printf 'Offline setup failed: wifi_on=%s mobile_data=%s\n' "$WIFI" "$DATA" >&2
exit 1
