"""Real shell-helper regressions using an explicit adb double, not device evidence."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ANDROID = Path(__file__).resolve().parents[1]
FAKE_ADB = '''import json,os,sys
from pathlib import Path
p=Path(os.environ['ADB_TEST_TRACE']); calls=json.loads(p.read_text()) if p.exists() else []
a=sys.argv[1:]; rooted=['root'] in calls;calls.append(a);p.write_text(json.dumps(calls))
if a==['shell','getprop','ro.kernel.qemu']:print(os.environ['TEST_QEMU'])
elif a==['root'] and os.environ['TEST_ROOT_ALLOWED']=='0':sys.exit(1)
elif a==['shell','id','-u']:print('0' if rooted else '2000')
elif a==['shell','svc','wifi','disable'] and int(os.environ['TEST_API'])<28 and not rooted:
 print('SecurityException: CHANGE_WIFI_STATE',file=sys.stderr);sys.exit(137)
elif a==['shell','settings','get','global','wifi_on']:print(os.environ['TEST_WIFI'])
elif a==['shell','settings','get','global','mobile_data']:print(os.environ['TEST_DATA'])
elif a==['shell','settings','get','global','airplane_mode_on']:print(os.environ['TEST_AIRPLANE'])
elif a==['shell','dumpsys','connectivity']:print('Active default network: '+os.environ['TEST_ACTIVE'])
'''

class OfflineSetupTests(unittest.TestCase):
    def run_setup(self,api: int | str=26,qemu='1',wifi='0',data='0',root_allowed='1',active='none',airplane='1'):
        helper=ANDROID/'prepare-offline-device.sh'
        self.assertTrue(helper.is_file(),'offline preparation helper must exist')
        with tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR')) as temp:
            root=Path(temp);trace=root/'trace.json';fake=root/'adb'
            fake.write_text('#!'+sys.executable+'\n'+FAKE_ADB);fake.chmod(0o755)
            sleep=root/'sleep';sleep.write_text('#!/bin/sh\nexit 0\n');sleep.chmod(0o755)
            env={**os.environ,'PATH':temp+os.pathsep+os.environ['PATH'],'ADB_TEST_TRACE':str(trace),
                 'TEST_API':str(api),'TEST_QEMU':qemu,'TEST_WIFI':wifi,'TEST_DATA':data,'TEST_ROOT_ALLOWED':root_allowed,
                 'TEST_ACTIVE':active,'TEST_AIRPLANE':airplane}
            result=subprocess.run(['bash',str(helper),str(api)],env=env,text=True,capture_output=True,timeout=5)
            calls=json.loads(trace.read_text()) if trace.exists() else []
            return result,calls

    def test_api26_roots_emulator_before_privileged_radio_commands(self):
        result,calls=self.run_setup()
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertLess(calls.index(['root']),calls.index(['shell','svc','wifi','disable']))
        self.assertIn(['shell','settings','get','global','wifi_on'],calls)
        self.assertIn(['shell','settings','get','global','mobile_data'],calls)

    def test_modern_image_does_not_need_root(self):
        result,calls=self.run_setup(api=35)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertNotIn(['root'],calls)

    def test_never_roots_a_physical_phone(self):
        result,calls=self.run_setup(qemu='0')
        self.assertNotEqual(result.returncode,0)
        self.assertNotIn(['root'],calls)
        self.assertNotIn(['shell','svc','wifi','disable'],calls)

    def test_rejects_enabled_wifi_instead_of_trusting_command_success(self):
        result,calls=self.run_setup(wifi='1')
        self.assertNotEqual(result.returncode,0)
        self.assertIn('wifi_on=1',result.stderr)

    def test_rejects_an_active_default_network(self):
        result,calls=self.run_setup(active='100')
        self.assertNotEqual(result.returncode,0)

    def test_mobile_preference_may_stay_enabled_when_airplane_mode_is_really_offline(self):
        result,calls=self.run_setup(api=35,data='1')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn(['shell','cmd','connectivity','airplane-mode','enable'],calls)
        self.assertIn(['shell','dumpsys','connectivity'],calls)

    def test_rejects_airplane_mode_off_even_without_a_default_network(self):
        result,calls=self.run_setup(airplane='0')
        self.assertNotEqual(result.returncode,0)

    def test_root_denial_is_not_ignored(self):
        result,calls=self.run_setup(root_allowed='0')
        self.assertNotEqual(result.returncode,0)
        self.assertNotIn(['shell','svc','wifi','disable'],calls)

    def test_invalid_api_rejected_before_adb(self):
        result,calls=self.run_setup(api='oops')
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(calls,[])

if __name__=='__main__':unittest.main()
