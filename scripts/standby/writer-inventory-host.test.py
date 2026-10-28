import contextlib
import importlib.util
import io
from pathlib import Path
import unittest
import tempfile
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('inventory', Path(__file__).with_name('writer-inventory-host.py'))
inventory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inventory)

class HostInventoryTest(unittest.TestCase):
    def test_failures_do_not_expose_process_or_schedule_content(self):
        output = io.StringIO()
        with patch.object(inventory, 'inspect', side_effect=PermissionError('sensitive-command-value')), contextlib.redirect_stdout(output):
            self.assertEqual(inventory.main(), 1)
        self.assertEqual(output.getvalue(), '{"host": {"status": "unavailable"}}\n')
        self.assertNotIn('sensitive-command-value', output.getvalue())

    def test_counts_unattributed_timers_and_crontab_lines(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            proc = root / 'proc'
            etc = root / 'etc'
            proc.mkdir()
            (etc / 'cron.d').mkdir(parents=True)
            (etc / 'crontab').write_text('# comment\n0 * * * * root secret-command\n')
            (etc / 'cron.d' / 'job').write_text('1 * * * * root another-secret\n')
            def run(args, **kwargs):
                if args[0] == 'systemctl':
                    return SimpleNamespace(stdout='timer1\ntimer2\n', stderr='', returncode=0)
                return SimpleNamespace(stdout='', stderr='no crontab for user', returncode=1)
            self.assertEqual(inventory.inspect(proc, etc, run, 1), dict(unit=0, outside=0, unreadable=0, unattributedTimers=2, unattributedCronLines=2))

    def test_reports_only_summary(self):
        output = io.StringIO()
        counts = dict(unit=1, outside=2, unreadable=0, unattributedTimers=3, unattributedCronLines=4)
        with patch.object(inventory, 'inspect', return_value=counts), contextlib.redirect_stdout(output):
            self.assertEqual(inventory.main(), 0)
        self.assertNotIn('argv', output.getvalue())
        self.assertNotIn('environment', output.getvalue())

if __name__ == '__main__':
    unittest.main()
