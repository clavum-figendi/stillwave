#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
mkdir -p "${TMPDIR:-$ROOT/build}"
OUT=$(mktemp -d "${TMPDIR:-$ROOT/build}/stillwave-worker.XXXXXX")
trap 'rm -rf "$OUT"' EXIT HUP INT TERM
JAVAC=${JAVA_HOME:+$JAVA_HOME/bin/}javac
JAVA=${JAVA_HOME:+$JAVA_HOME/bin/}java
# These Android doubles live outside app sources and are never packaged in an APK.
"$JAVAC" --release 17 -d "$OUT" "$ROOT"/worker-tests/android/content/*.java "$ROOT"/worker-tests/android/media/*.java "$ROOT"/worker-tests/android/os/*.java "$ROOT"/worker-tests/net/stillwave/app/*.java "$ROOT"/app/src/main/java/net/stillwave/audio/*.java "$ROOT"/app/src/main/java/net/stillwave/app/AudioEngine.java
"$JAVA" -cp "$OUT" net.stillwave.app.WorkerTests
