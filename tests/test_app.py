"""Run: python -m unittest discover -s tests -p 'test_*.py' (stdlib only; needs the app requirements installed)."""
import base64
import importlib
import os
import unittest
from unittest import mock


def load(**env):
    keys = ("HOST", "AUTH_USER", "AUTH_PASSWORD", "ANALYTICS_URL", "ANALYTICS_TOKEN", "RAILWAY_ENVIRONMENT", "STATE_DIR")
    clean = {k: v for k, v in os.environ.items() if k not in keys}
    with mock.patch.dict(os.environ, {**clean, **env}, clear=True):
        import app
        return importlib.reload(app)


class AppTest(unittest.TestCase):
    def test_public_deploy_without_password_refuses_to_start(self):
        with self.assertRaises(RuntimeError):
            load(RAILWAY_ENVIRONMENT="production")
        with self.assertRaises(RuntimeError):
            load(HOST="0.0.0.0")

    def test_local_run_needs_no_password(self):
        self.assertEqual(load().app.test_client().get("/api/sources").status_code, 200)

    def test_basic_auth_when_password_set(self):
        m = load(AUTH_PASSWORD="pw", STATE_DIR="/tmp/tv-state-test")
        c = m.app.test_client()
        self.assertEqual(c.get("/api/sources").status_code, 401)
        ok = {"Authorization": "Basic " + base64.b64encode(b"admin:pw").decode()}
        bad = {"Authorization": "Basic " + base64.b64encode(b"admin:no").decode()}
        self.assertEqual(c.get("/api/sources", headers=ok).status_code, 200)
        self.assertEqual(c.get("/api/sources", headers=bad).status_code, 401)

    def test_bot_trades_proxy(self):
        m = load()
        c = m.app.test_client()
        self.assertEqual(c.get("/api/bot/trades").status_code, 503)
        resp = mock.Mock(status_code=200, **{"json.return_value": [{"id": "1"}], "raise_for_status.return_value": None})
        env = {"ANALYTICS_URL": "http://analytics", "ANALYTICS_TOKEN": "tok"}
        with mock.patch.dict(os.environ, env), mock.patch.object(m.requests, "get", return_value=resp) as get:
            out = m.app.test_client().get("/api/bot/trades?limit=5")
        self.assertEqual(out.get_json(), [{"id": "1"}])
        self.assertEqual(get.call_args.args[0], "http://analytics/api/v1/trader/trades")
        self.assertEqual(get.call_args.kwargs["headers"], {"Authorization": "Bearer tok"})
        self.assertEqual(get.call_args.kwargs["params"], {"limit": 5})


if __name__ == "__main__":
    unittest.main()
