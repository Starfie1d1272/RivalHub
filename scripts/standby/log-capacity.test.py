import importlib.util
import json
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('log_capacity', Path(__file__).with_name('log-capacity.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class LogCapacityTest(unittest.TestCase):
    def test_only_counts_leave_aggregation(self):
        secret = 'email@example.com token=do-not-return'
        result = module.summarize([
            json.dumps({'_SYSTEMD_UNIT': 'rivalhub-production.service', 'MESSAGE': secret}),
            json.dumps({'_SYSTEMD_UNIT': 'private-person.service', 'MESSAGE': [1, 2, 3]}),
            'broken', '[]',
        ])
        self.assertEqual(result['entries'], 2)
        self.assertEqual(result['messageBytes'], len(secret.encode()) + 3)
        self.assertEqual(result['malformedRows'], 2)
        self.assertNotIn(secret, json.dumps(result))
        self.assertNotIn('private-person', json.dumps(result))
        self.assertEqual(module.message_bytes([1, 'secret']), 0)


if __name__ == '__main__':
    unittest.main()
