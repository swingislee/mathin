import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("monitor", Path(__file__).resolve().parents[1] / "web-push-monitor.py")
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)


def healthy(**changes):
    return {"featureEnabled": True, "integrationStatus": "enabled", "providerAuthError": False,
            "workerAgeSeconds": 10, "oldestDueSeconds": 0, "dead": 0, "failed24h": 0,
            "queued": 0, "sent24h": 1, **changes}


class MonitorTests(unittest.TestCase):
    def test_alert_deduplication_and_recovery(self):
        emails = []
        send = lambda *args: emails.append(args)
        state = monitor.poll(healthy(), {}, 1000, send)
        self.assertEqual(emails, [])
        state = monitor.poll(healthy(workerAgeSeconds=None), state, 1060, send)
        self.assertEqual(emails[-1][0:2], ("alert", ["WORKER_STALE"]))
        state = monitor.poll(healthy(workerAgeSeconds=300), state, 1120, send)
        self.assertEqual(len(emails), 1)
        state = monitor.poll(healthy(), state, 1180, send)
        self.assertEqual(emails[-1][0:2], ("recovered", []))
        monitor.poll(healthy(), state, 1240, send)
        self.assertEqual(len(emails), 2)

    def test_worker_independent_auth_and_read_failure(self):
        issues, _ = monitor.classify(healthy(integrationStatus="degraded", providerAuthError=True), {}, 1)
        self.assertIn("PROVIDER_AUTH_ERROR", issues)
        self.assertIn("CHANNEL_DEGRADED", issues)
        self.assertEqual(monitor.classify(None, {}, 1)[0], ["MONITOR_READ_FAILED"])

    def test_disabled_channel_is_quiet(self):
        for snapshot in (healthy(featureEnabled=False), healthy(integrationStatus="disabled", workerAgeSeconds=None)):
            self.assertEqual(monitor.classify(snapshot, {}, 1)[0], [])

    def test_queue_threshold_is_sustained(self):
        old = healthy(oldestDueSeconds=100)
        issues, since = monitor.classify(old, {}, 1000)
        self.assertNotIn("QUEUE_STALLED", issues)
        issues, _ = monitor.classify(old, {"slowSince": since}, 1300)
        self.assertIn("QUEUE_STALLED", issues)
        self.assertEqual(monitor.classify(healthy(), {"slowSince": since}, 1400)[1], None)

    def test_malformed_data_is_rejected_and_private_fields_removed(self):
        with self.assertRaises(ValueError):
            monitor.validate_snapshot(healthy(dead="endpoint-secret"))
        with self.assertRaises(ValueError):
            monitor.validate_snapshot(healthy(workerAgeSeconds=float("nan")))
        clean = monitor.validate_snapshot(healthy(endpoint="private", key="private"))
        self.assertNotIn("endpoint", clean)
        self.assertNotIn("key", clean)

    def test_mail_failure_is_not_recorded_as_sent(self):
        previous = {"issues": [], "lastSent": 1000}
        def fail(*args):
            raise RuntimeError("delivery failed")
        with self.assertRaises(RuntimeError):
            monitor.poll(healthy(dead=1), previous, 2000, fail)
        self.assertEqual(previous, {"issues": [], "lastSent": 1000})


if __name__ == "__main__":
    unittest.main()
