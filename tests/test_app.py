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


    def test_bot_summary(self):
        m = load()
        t = lambda i, st, pnl, r, day: {"id": i, "status": st, "pnl": pnl, "r_multiple": r, "fees": "1", "closed_at": f"2026-10-{day:02d}T00:00:00Z"}
        out = m.bot_summary([t(1, "closed", "30", "2", 3), t(2, "closed", "-20", "-1", 1), t(3, "closed", "-25", "-1.2", 2),
                             {"id": 4, "status": "open"}, {"id": 5, "status": "skipped"}])
        self.assertEqual((out["closed"], out["wins"], out["no_entry"], len(out["open"])), (3, 1, 1, 1))
        self.assertEqual([c[1] for c in out["curve"]], [-20, -45, -15])  # ordered by closing time
        self.assertEqual((out["pnl"], out["max_drawdown"], out["profit_factor"], out["fees"]), (-15, 45, 30 / 45, 3))
        self.assertAlmostEqual(out["total_r"], -0.2)
        self.assertIsNone(m.bot_summary([])["win_rate"])
        self.assertIsNone(m.bot_summary([t(1, "closed", "5", "1", 1)])["profit_factor"])


class TradingApiTest(unittest.TestCase):
    """Paper trading over HTTP with the market data mocked: fills come only from server-side prices."""

    def setUp(self):
        import tempfile
        self.m = load(STATE_DIR=tempfile.mkdtemp())
        self.c = self.m.app.test_client()
        self.t = 1_800_000_000  # a whole minute
        self.bars = {}  # "source:SYMBOL" -> list of 1m bars, or an Exception to raise
        patches = [mock.patch.object(self.m, "minute_bars", side_effect=self.fake_bars), mock.patch.object(self.m.time, "time", side_effect=lambda: self.t)]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        r = self.c.post("/api/trading/accounts", json={"name": "Demo", "currency": "USD", "initial": 10000, "fee_bps": 10, "slippage_bps": 0})
        self.assertEqual(r.status_code, 201)
        self.aid = r.get_json()["account"]["id"]

    def fake_bars(self, key):
        b = self.bars.get(key, [])
        if isinstance(b, Exception):
            raise b
        return b

    def bar(self, t, o, h, low, c):
        return {"time": t, "open": o, "high": h, "low": low, "close": c, "volume": 1}

    def order(self, cid, **kw):
        return self.c.post(f"/api/trading/accounts/{self.aid}/orders", json={"client_order_id": cid, "source": "crypto", "symbol": "BTC", **kw})

    def state(self):
        return self.c.get(f"/api/trading/accounts/{self.aid}").get_json()

    def test_account_creation_is_validated(self):
        self.assertEqual(self.c.post("/api/trading/accounts", json={"name": "x", "currency": "EUR", "initial": 5}).status_code, 400)
        self.assertEqual(self.c.post("/api/trading/accounts", json={"name": "x", "currency": "USD", "initial": "lots"}).status_code, 400)
        self.assertEqual(self.c.get("/api/trading/accounts/999").status_code, 404)
        self.assertEqual([a["name"] for a in self.c.get("/api/trading/accounts").get_json()], ["Demo"])

    def test_market_order_fills_once_at_the_server_price(self):
        self.bars["crypto:BTC"] = [self.bar(self.t - 60, 100, 100, 100, 100)]
        r = self.order("order-0001", side="buy", type="market", qty=1, price=1)  # the client's price is ignored
        r = self.order("order-0001", side="buy", type="market", qty=1)
        s = r.get_json()
        self.assertEqual([h["fill_price"] for h in s["history"]], [100])
        self.assertEqual(s["positions"][0]["qty"], 1)
        self.assertAlmostEqual(s["summary"]["balance"], 10000 - 0.1)

    def test_amount_in_account_currency_becomes_a_quantity_at_the_server_price(self):
        self.bars["crypto:BTC"] = [self.bar(self.t - 60, 80000, 80000, 80000, 80000)]
        s = self.order("cash-0001", side="buy", type="market", notional=1000, price=1).get_json()  # the client's price is ignored
        self.assertEqual(s["positions"][0]["qty"], 0.0125)
        s = self.order("cash-0002", side="buy", type="limit", notional=1000, price=50000).get_json()
        self.assertEqual(s["orders"][0]["qty"], 0.02)
        self.bars["us:AAPL"] = [self.bar(self.t - 60, 150, 150, 150, 150)]
        s = self.order("cash-0003", side="buy", type="market", notional=1000, source="us", symbol="AAPL").get_json()
        self.assertEqual(s["positions"][-1]["qty"], 6)  # whole shares, rounded down
        self.assertEqual(self.order("cash-0004", side="buy", type="market", notional=100, source="us", symbol="AAPL").status_code, 400)
        self.assertEqual(self.order("cash-0005", side="buy", type="market", notional=-5).status_code, 400)

    def test_no_recent_price_rejects_instead_of_filling(self):
        self.bars["crypto:BTC"] = [self.bar(self.t - 3600, 100, 100, 100, 100)]
        h = self.order("order-0002", side="buy", type="market", qty=1).get_json()["history"][0]
        self.assertEqual((h["status"], h["reason"]), ("rejected", "no market price"))
        self.bars["crypto:BTC"] = RuntimeError("upstream down")
        self.assertEqual(self.order("order-0003", side="buy", type="market", qty=1).get_json()["history"][0]["status"], "rejected")
        self.assertEqual(self.state()["summary"]["balance"], 10000)

    def test_instrument_rules(self):
        self.assertEqual(self.order("order-0004", side="buy", type="market", qty=1, source="ru", symbol="SBER").status_code, 400)
        self.assertEqual(self.order("order-0005", side="buy", type="market", qty=1.5, source="us", symbol="AAPL").status_code, 400)
        self.assertEqual(self.order("short", side="buy", type="market", qty=1).status_code, 400)  # client_order_id too short

    def test_limit_and_stop_loss_fill_on_later_bars_only(self):
        self.order("order-0006", side="buy", type="limit", qty=2, price=90)
        self.bars["crypto:BTC"] = RuntimeError("down")
        self.t += 120
        self.assertIn("crypto:BTC", self.state()["errors"])  # a data error fills nothing
        self.bars["crypto:BTC"] = [self.bar(self.t - 180, 95, 96, 80, 95), self.bar(self.t - 120, 95, 96, 89, 92), self.bar(self.t - 60, 92, 93, 91, 92)]
        s = self.state()  # the bar that opened before the order was placed can't fill it, the next one does
        self.assertEqual((s["positions"][0]["qty"], s["positions"][0]["avg_price"]), (2, 90))
        self.assertEqual(s["history"][0]["fill_time"], self.t - 120)
        r = self.c.put(f"/api/trading/accounts/{self.aid}/exits", json={"symbol": "crypto:BTC", "sl": 85, "tp": 100})
        self.assertEqual(r.status_code, 200)
        self.t += 120
        self.bars["crypto:BTC"].append(self.bar(self.t - 120, 92, 101, 84, 95))  # both levels inside one bar: stop loss first
        s = self.state()
        self.assertEqual(s["positions"], [])
        self.assertEqual((s["history"][0]["reason"], s["history"][0]["fill_price"]), ("stop loss", 85))
        self.assertAlmostEqual(s["summary"]["realized"], -10)

    def test_close_and_cancel(self):
        self.bars["crypto:BTC"] = [self.bar(self.t - 60, 100, 100, 100, 100)]
        self.order("order-0007", side="sell", type="market", qty=1)
        s = self.c.post(f"/api/trading/accounts/{self.aid}/close", json={"client_order_id": "close-0001", "symbol": "crypto:BTC"}).get_json()
        self.assertEqual(s["positions"], [])
        oid = self.order("order-0008", side="buy", type="limit", qty=1, price=50).get_json()["orders"][0]["id"]
        s = self.c.delete(f"/api/trading/accounts/{self.aid}/orders/{oid}").get_json()
        self.assertEqual((s["orders"], s["history"][0]["status"]), ([], "cancelled"))

    def test_replay_session_over_http(self):
        start = self.t - 30 * 86400
        hist = [self.bar(start + (i - 20) * 3600, 100 + i, 101 + i, 99 + i, 100.5 + i) for i in range(60)]
        with mock.patch.object(self.m.data_source, "history", return_value=hist) as h:
            r = self.c.post("/api/trading/replays", json={"source": "crypto", "symbol": "BTC", "tf": "1h", "start": start + 5, "initial": 1000})
        self.assertEqual(r.status_code, 201, r.get_json())
        self.assertEqual(h.call_args.args[:4], ("crypto", "BTC", "1h", start))
        rid, rep = r.get_json()["account"]["id"], r.get_json()["replay"]
        self.assertEqual(rep["cursor"], start)
        bars = self.c.get(f"/api/trading/replays/{rid}/bars?tf=1h").get_json()
        self.assertEqual(bars[-1]["time"], start - 3600)  # nothing at or after the start
        o = self.c.post(f"/api/trading/accounts/{rid}/orders", json={"client_order_id": "replay-001", "source": "crypto", "symbol": "BTC",
                                                                    "side": "buy", "type": "market", "qty": 1}).get_json()
        self.assertEqual(o["orders"][0]["status"], "open")  # waits for the next bar's open, no live price involved
        self.assertEqual(self.c.post(f"/api/trading/accounts/{rid}/orders", json={"client_order_id": "replay-002", "source": "crypto", "symbol": "ETH",
                                                                                 "side": "buy", "type": "market", "qty": 1}).status_code, 400)
        s = self.c.post(f"/api/trading/replays/{rid}/step", json={"n": 3, "tf": "1h"}).get_json()
        self.assertEqual((s["stepped"], s["replay"]["cursor"], s["bars"][-1]["time"]), (3, start + 3 * 3600, start + 2 * 3600))
        self.assertAlmostEqual(s["positions"][0]["avg_price"], 120 * 1.0002)  # open of the first bar after the order + 2 bps slippage
        s = self.c.post(f"/api/trading/replays/{rid}/seek", json={"time": start}).get_json()
        self.assertEqual((s["positions"], s["orders"], s["replay"]["cursor"]), ([], [], start))
        self.assertEqual(self.c.put(f"/api/trading/replays/{rid}", json={"speed": 3}).status_code, 400)
        self.assertEqual(self.c.put(f"/api/trading/replays/{rid}", json={"speed": 5}).get_json()["replay"]["speed"], 5)
        self.assertEqual(self.c.get(f"/api/trading/replays/{rid}/bars?tf=15m").status_code, 400)
        self.assertEqual(self.c.get(f"/api/trading/replays/{self.aid}/bars?tf=1h").status_code, 404)  # a paper account has no session
        self.c.post(f"/api/trading/replays/{rid}/step", json={"n": 3, "tf": "1h"})
        rep = self.c.get(f"/api/trading/accounts/{rid}/report").get_json()
        self.assertEqual((rep["trades"], rep["end"], len(rep["curve"])), (0, start + 3 * 3600, 4))
        self.assertAlmostEqual(rep["buy_and_hold"]["return_pct"], 122.5 / 120 - 1)
        s = self.c.post(f"/api/trading/replays/{rid}/end").get_json()
        self.assertEqual(s["account"]["status"], "ended")
        self.assertEqual(self.c.post(f"/api/trading/replays/{rid}/step", json={"n": 1, "tf": "1h"}).status_code, 400)
        self.assertEqual(self.c.post(f"/api/trading/accounts/{rid}/reset", json={}).status_code, 400)  # needs the explicit confirmation
        s = self.c.post(f"/api/trading/accounts/{rid}/reset", json={"confirm": True}).get_json()
        self.assertEqual((s["account"]["status"], s["summary"]["balance"], s["positions"], s["replay"]["cursor"]), ("active", 1000, [], start))
        self.assertEqual(self.state()["account"]["status"], "active")  # the paper account is untouched
        with mock.patch.object(self.m.data_source, "history", return_value=hist[25:]):
            r = self.c.post("/api/trading/replays", json={"source": "crypto", "symbol": "BTC", "tf": "1h", "start": start, "initial": 1000})
        self.assertIn("only available from", r.get_json()["error"])


class HistoryTest(unittest.TestCase):
    def test_pages_back_to_the_warmup_and_stops_when_the_source_runs_out(self):
        import data_source

        def fetch(symbol, tf, before=None):  # 100 one-minute bars per page, none before t=50000
            return [{"time": t} for t in range(max(50000, before - 6000), before, 60)]
        with mock.patch.dict(data_source.HISTORY, {"crypto": fetch}):
            bars = data_source.history("crypto", "BTC", "1m", start=200000, end=230000, warmup=300)
            times = [b["time"] for b in bars]
            self.assertEqual((times[0], times[-1]), (200000 - 300 * 60, 229940))
            self.assertEqual(times, sorted(set(times)))  # no gaps or duplicates between pages
            self.assertEqual(data_source.history("crypto", "BTC", "1m", start=60000, end=70000)[0]["time"], 50000)


if __name__ == "__main__":
    unittest.main()
