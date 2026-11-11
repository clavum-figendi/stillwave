#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
mkdir -p "${TMPDIR:-$ROOT/build}"
OUT=$(mktemp -d "${TMPDIR:-$ROOT/build}/stillwave-core.XXXXXX")
trap 'rm -rf "$OUT"' EXIT HUP INT TERM
JAVAC=${JAVA_HOME:+$JAVA_HOME/bin/}javac
JAVA=${JAVA_HOME:+$JAVA_HOME/bin/}java
"$JAVAC" --release 17 -d "$OUT" "$ROOT"/app/src/main/java/net/stillwave/audio/*.java "$ROOT"/core-tests/net/stillwave/audio/*.java
"$JAVA" -cp "$OUT" net.stillwave.audio.CoreTests
"$ROOT/run-worker-tests.sh"
