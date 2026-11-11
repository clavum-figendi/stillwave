"""Harness/probe policy regressions; command doubles are not Android runtime evidence."""
import os
import pathlib, re, subprocess, tempfile, unittest
ROOT = pathlib.Path(__file__).resolve().parents[2]
JAVA = ROOT / 'android/app/src/androidTest/java/net/stillwave/app/OfflineInstrumentation.java'
class ProbeTests(unittest.TestCase):
    def test_deadline_policy(self):
        source = JAVA.read_text()
        match = re.search(r'    static final class CallbackDeadline \{.*?\n    \}', source, re.S)
        assert match is not None, 'Pure Java CallbackDeadline helper is missing'
        code = '''public class DeadlineProbe {
%s
public static void main(String[] args) {
 CallbackDeadline d = new CallbackDeadline(1000);
 if (d.remainingMillis(1000, 5000) != 5000) throw new AssertionError("initial wait");
 if (d.remainingMillis(6000, 5000) != 0) throw new AssertionError("diagnostic threshold");
 if (d.remainingMillis(8000, 30000) != 23000) throw new AssertionError("diagnostics consume grace");
 if (d.remainingMillis(31000, 30000) != 0) throw new AssertionError("total deadline");
 if (d.remainingMillis(32000, 30000) != 0) throw new AssertionError("no negative wait");
 System.out.println("PASS: deterministic callback deadline boundaries");
}
}''' % match.group(0)
        with tempfile.TemporaryDirectory(prefix='callback-probe-', dir=os.environ.get('TMPDIR', os.environ.get('RUNNER_TEMP'))) as d:
            path = pathlib.Path(d) / 'DeadlineProbe.java'
            path.write_text(code)
            subprocess.run(['javac', str(path)], check=True)
            subprocess.run(['java', '-cp', d, 'DeadlineProbe'], check=True)
    def test_probe_protocol(self):
        source = JAVA.read_text()
        self.assertIn('Thread.getAllStackTraces()', source)
        self.assertIn('phase=callback', source)
        self.assertIn('phase=submitted', source)
        self.assertIn('phase=enqueue', source)
        self.assertIn('late=', source)
        self.assertIn('location.origin===\'https://appassets.androidplatform.net\' && typeof NativeAudio===\'object\' && document.querySelectorAll(\'button\').length>0', source)
    def test_ci_bounds(self):
        source = (ROOT / 'android/ci-offline-test.sh').read_text()
        self.assertEqual(source.count('timeout 120s adb install --no-streaming -r'), 2)
        self.assertIn('timeout 240s adb shell am instrument', source)
        self.assertIn('INSTRUMENT_STATUS=("${PIPESTATUS[@]}")', source)
        self.assertIn('bash "$ROOT/android/prepare-offline-device.sh" "$API"', source)
    def test_ci_failure_artifacts_with_command_doubles(self):
        import os
        with tempfile.TemporaryDirectory(prefix='ci-protocol-', dir=os.environ.get('TMPDIR', os.environ.get('RUNNER_TEMP'))) as directory:
            base = pathlib.Path(directory)
            (base / 'timeout').write_text('''#!/bin/bash
printf '%s\\n' "$*" >> "$COMMAND_LOG"
limit=$1; shift
if [[ ${FAIL_STAGE:-} == install && $limit == 120s ]]; then exit 124; fi
if [[ ${FAIL_STAGE:-} == instrument && $limit == 240s ]]; then exit 124; fi
exec "$@"
''')
            (base / 'adb').write_text('''#!/bin/bash
printf '%s\\n' "$*" >> "$COMMAND_LOG"
case "$*" in
 'shell getprop ro.build.version.sdk') echo 35;;
 'shell settings get global wifi_on'|'shell settings get global mobile_data') echo 0;;
 'shell am instrument '*) printf 'INSTRUMENTATION_CODE: -1\\nStillwave: 1 offline integration test passed\\n';;
 'logcat -d') echo 'mock logcat diagnostic';;
 'shell dumpsys '*) echo 'mock dumpsys diagnostic';;
 'exec-out screencap -p') echo 'mock screenshot placeholder';;
esac
''')
            for command in ('timeout', 'adb'): (base / command).chmod(0o755)
            for stage in ('success', 'install', 'instrument'):
                logdir = base / stage
                env = dict(os.environ, PATH=str(base) + ':' + os.environ['PATH'], STILLWAVE_TEST_LOG_DIR=str(logdir), COMMAND_LOG=str(base / 'commands'), FAIL_STAGE=stage)
                result = subprocess.run(['bash', str(ROOT / 'android/ci-offline-test.sh')], env=env, capture_output=True, text=True)
                self.assertEqual(result.returncode == 0, stage == 'success', result.stderr)
                for artifact in ('logcat.txt', 'services.txt', 'media-session.txt', 'final-screen.png'):
                    self.assertTrue((logdir / artifact).exists(), (stage, artifact))
                if stage == 'instrument': self.assertIn('adb instrumentation command failed', result.stderr)
            print('PASS: command-double CI success/install timeout/instrument timeout and EXIT artifacts (not device evidence)')
if __name__ == '__main__': unittest.main()
