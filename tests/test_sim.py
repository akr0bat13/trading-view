"""Run: python -m unittest discover -s tests -p 'test_*.py'. The virtual execution engine (sim.py), no network."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import sim  # noqa: E402

bar = lambda t, o, h, l, c: {"time": t, "open": o, "high": h, "low": l, "close": c}  # noqa: E731


class RulesTest(unittest.TestCase):
    def test_position_math_long_partial_close_flip(self):
        q, avg, r = sim.apply_fill(0, 0, 2, 100)
        q, avg, r = sim.apply_fill(q, avg, 2, 110)
        self.assertEqual((q, avg, r), (4, 105, 0))
        q, avg, r = sim.apply_fill(q, avg, -1, 120)  # partial close keeps the average
        self.assertEqual((q, avg, r), (3, 105, 15))
        q, avg, r = sim.apply_fill(q, avg, -5, 100)  # close 3 at a loss, open a short of 2 at 100
        self.assertEqual((q, avg, r), (-2, 100, -15))
        self.assertEqual(sim.apply_fill(q, avg, 2, 90), (0, 0, 20))  # short profits when price falls

    def test_slippage_is_always_against_the_trader(self):
        self.assertGreater(sim.slipped(100, "buy", 10), 100)
        self.assertLess(sim.slipped(100, "sell", 10), 100)

    def test_order_never_fills_on_the_bar_it_was_placed_on(self):
        o = {"type": "limit", "side": "buy", "price": 95, "created_at": 1000}
        self.assertIsNone(sim.match(o, bar(940, 100, 101, 90, 96), 0))  # bar opened before the order: already history
        self.assertEqual(sim.match(o, bar(1000, 100, 101, 94, 96), 0), 95)
        self.assertIsNone(sim.match(o, bar(1000, 100, 101, 96, 97), 0))  # never touched 95
        self.assertEqual(sim.match(o, bar(1000, 90, 92, 89, 91), 0), 90)  # gapped below: fills at the open, not the limit
        m = {"type": "market", "side": "buy", "created_at": 1000}
        self.assertAlmostEqual(sim.match(m, bar(1000, 100, 110, 90, 105), 10), 100.1)  # next open + slippage, never the close
        s = {"type": "limit", "side": "sell", "price": 105, "created_at": 0}
        self.assertEqual(sim.match(s, bar(0, 107, 108, 100, 101), 0), 107)

    def test_stop_loss_wins_when_both_exits_hit_in_one_bar(self):
        self.assertEqual(sim.exit_hit(1, 95, 110, bar(0, 100, 111, 94, 100), 0), (95, "sl"))
        self.assertEqual(sim.exit_hit(-1, 105, 90, bar(0, 100, 106, 89, 100), 0), (105, "sl"))
        self.assertEqual(sim.exit_hit(1, 95, 110, bar(0, 100, 111, 96, 100), 0), (110, "tp"))
        self.assertEqual(sim.exit_hit(1, 95, 110, bar(0, 90, 92, 88, 91), 0), (90, "sl"))  # gap through the stop: fills at the open
        self.assertIsNone(sim.exit_hit(1, 95, 110, bar(0, 100, 105, 96, 100), 0))

    def test_bad_orders_are_described(self):
        for args in [("hold", "market", 1, None, 100), ("buy", "stop", 1, None, 100), ("buy", "market", 0, None, 100),
                     ("buy", "market", float("nan"), None, 100), ("buy", "market", True, None, 100),
                     ("buy", "limit", 1, -5, -5), ("buy", "market", 1, None, None)]:
            self.assertIsNotNone(sim.check_order(*args), args)
        self.assertIsNone(sim.check_order("sell", "limit", 0.5, 10, 10))


class StorageTest(unittest.TestCase):
    def setUp(self):
        self.db = sim.connect(":memory:")
        self.aid = sim.create_account(self.db, "me", "Demo", "paper", "USD", 10_000, fee_bps=10, slippage_bps=0)

    def order(self, cid, side, qty, price, **kw):
        return sim.place_order(self.db, "me", self.aid, cid, "BTC", side, "market", qty, mark=price, fill_at=price, **kw)

    def summary(self, marks=None):
        return sim.summary(self.db, sim.account(self.db, "me", self.aid), marks or {})

    def ledger_sum(self):
        return self.db.execute("SELECT SUM(delta) FROM ledger WHERE account_id = ?", (self.aid,)).fetchone()[0]

    def test_round_trip_updates_balance_position_and_ledger(self):
        self.assertEqual(self.order("a", "buy", 1, 100)["status"], "filled")
        self.assertEqual(sim.position(self.db, self.aid, "BTC")["qty"], 1)
        s = self.summary({"BTC": 120})
        self.assertAlmostEqual(s["balance"], 10_000 - 0.1)
        self.assertAlmostEqual(s["unrealized"], 20)
        self.order("b", "sell", 1, 120)
        self.assertIsNone(sim.position(self.db, self.aid, "BTC"))
        s = self.summary()
        self.assertAlmostEqual(s["realized"], 20)
        self.assertAlmostEqual(s["balance"], 10_000 + 20 - 0.1 - 0.12)
        self.assertAlmostEqual(self.ledger_sum(), s["balance"])  # cash is exactly the sum of its ledger

    def test_retried_request_does_not_trade_twice(self):
        first = self.order("same", "buy", 1, 100)
        again = self.order("same", "buy", 1, 100)
        self.assertEqual(first["id"], again["id"])
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM fills").fetchone()[0], 1)
        self.assertIsNone(sim.fill(self.db, first["id"], 100, 0))  # filling a filled order is a no-op

    def test_insufficient_funds_and_missing_price_are_rejected_without_touching_cash(self):
        self.assertEqual(self.order("big", "buy", 101, 100)["reason"], "insufficient funds")
        o = sim.place_order(self.db, "me", self.aid, "nop", "BTC", "buy", "market", 1, mark=None)
        self.assertEqual((o["status"], o["reason"]), ("rejected", "no market price"))
        self.assertEqual(self.summary()["balance"], 10_000)
        self.order("half", "buy", 60, 100)
        self.assertEqual(self.order("sell", "sell", 60, 100)["status"], "filled")  # closing needs no extra margin

    def test_open_limits_reserve_funds_and_can_be_cancelled(self):
        o = sim.place_order(self.db, "me", self.aid, "l1", "BTC", "buy", "limit", 50, price=100)
        self.assertEqual(o["status"], "open")
        self.assertEqual(sim.place_order(self.db, "me", self.aid, "l2", "BTC", "buy", "limit", 50, price=100)["reason"], "insufficient funds")
        self.assertTrue(sim.cancel_order(self.db, "me", self.aid, o["id"]))
        self.assertFalse(sim.cancel_order(self.db, "me", self.aid, o["id"]))
        self.assertIsNone(sim.fill(self.db, o["id"], 100, 0))  # a cancelled order can't fill

    def test_other_owner_sees_nothing(self):
        with self.assertRaises(KeyError):
            sim.account(self.db, "intruder", self.aid)
        with self.assertRaises(KeyError):
            sim.place_order(self.db, "intruder", self.aid, "x", "BTC", "buy", "market", 1, mark=100, fill_at=100)
        with self.assertRaises(KeyError):
            sim.cancel_order(self.db, "intruder", self.aid, 1)

    def test_failure_mid_fill_rolls_everything_back(self):
        o = sim.place_order(self.db, "me", self.aid, "l", "BTC", "buy", "limit", 1, price=100)
        self.db.execute("CREATE TRIGGER boom BEFORE UPDATE OF status ON orders BEGIN SELECT RAISE(ABORT, 'boom'); END")
        with self.assertRaises(Exception):
            sim.fill(self.db, o["id"], 100, 0)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM fills").fetchone()[0], 0)
        self.assertIsNone(sim.position(self.db, self.aid, "BTC"))
        self.assertEqual(self.summary()["balance"], 10_000)

    def test_exits_are_checked_against_the_current_price(self):
        self.order("a", "buy", 1, 100)
        with self.assertRaises(ValueError):
            sim.set_exits(self.db, "me", self.aid, "BTC", 100, sl=101)
        sim.set_exits(self.db, "me", self.aid, "BTC", 130, sl=110, tp=150)  # a stop trailed into profit is fine
        p = sim.position(self.db, self.aid, "BTC")
        self.assertEqual((p["sl"], p["tp"]), (110, 150))
        self.order("b", "buy", 1, 130)  # adding keeps the exits
        self.assertEqual(sim.position(self.db, self.aid, "BTC")["sl"], 110)

    def test_account_validation(self):
        for kw in [{"initial": 0}, {"initial": float("inf")}, {"name": " "}, {"fee_bps": -1}]:
            args = {"name": "x", "initial": 100, **kw}
            with self.assertRaises(ValueError):
                sim.create_account(self.db, "me", args["name"], "paper", "USD", args["initial"], fee_bps=kw.get("fee_bps", 5))


class ReplayTest(unittest.TestCase):
    """15m session starting at bar 10 of 40; prices rise 1 per bar from 100."""

    def setUp(self):
        self.db = sim.connect(":memory:")
        self.bars = [bar(i * 900, 100 + i, 100.5 + i, 99.5 + i, 100.5 + i) for i in range(40)]
        self.start = 10 * 900
        self.aid = sim.create_replay(self.db, "me", "R", "crypto", "BTC", "15m", "USD", 10_000, self.bars, self.start, fee_bps=0, slippage_bps=0)

    def state(self):
        a = sim.account(self.db, "me", self.aid)
        return sim.snapshot(self.db, a, {"crypto:BTC": sim.last_price(self.db, self.aid)})

    def test_no_bar_from_the_future_is_ever_served(self):
        for n in (0, 1, 5):
            sim.step(self.db, "me", self.aid, n) if n else None
            cursor = sim.session(self.db, self.aid)["cursor"]
            for tf in ("15m", "30m", "1h", "1d"):
                bars = sim.known_bars(self.db, self.aid, tf)
                self.assertTrue(bars)
                self.assertLessEqual(bars[-1]["time"], cursor - 900, tf)  # the newest bucket starts at or before the last closed bar
            last = sim.known_bars(self.db, self.aid, "15m")[-1]
            self.assertEqual(last["time"] + 900, cursor)
            self.assertEqual(sim.last_price(self.db, self.aid), last["close"])
        hourly = sim.known_bars(self.db, self.aid, "1h")[-1]  # a forming hour is built only from closed 15m bars
        closed = [b for b in self.bars if b["time"] + 900 <= sim.session(self.db, self.aid)["cursor"] and b["time"] >= hourly["time"]]
        self.assertEqual((hourly["close"], hourly["high"]), (closed[-1]["close"], max(b["high"] for b in closed)))
        with self.assertRaises(ValueError):
            sim.known_bars(self.db, self.aid, "5m")  # finer than the session's bars
        self.assertTrue(all(b["time"] < 900 * 5 for b in sim.known_bars(self.db, self.aid, "15m", before=900 * 5)))

    def test_market_order_fills_at_the_next_open_and_steps_run_exits(self):
        cursor = sim.session(self.db, self.aid)["cursor"]
        o = sim.place_order(self.db, "me", self.aid, "m1", "crypto:BTC", "buy", "market", 10, mark=sim.last_price(self.db, self.aid), now=cursor)
        self.assertEqual(o["status"], "open")
        sim.step(self.db, "me", self.aid, 1)
        self.assertEqual(self.state()["positions"][0]["avg_price"], self.bars[10]["open"])
        sim.set_exits(self.db, "me", self.aid, "crypto:BTC", sim.last_price(self.db, self.aid), tp=114, now=sim.session(self.db, self.aid)["cursor"])
        sim.step(self.db, "me", self.aid, 10)
        s = self.state()
        self.assertEqual(s["positions"], [])
        self.assertEqual((s["history"][0]["reason"], s["history"][0]["fill_price"]), ("take profit", 114))

    def test_rewind_restores_the_account_exactly(self):
        def at(t):
            cur = sim.session(self.db, self.aid)["cursor"]
            sim.step(self.db, "me", self.aid, (t - cur) // 900)
        sim.place_order(self.db, "me", self.aid, "a", "crypto:BTC", "buy", "market", 10, mark=110, now=self.start)
        at(self.start + 3 * 900)
        snap = self.state()
        sim.place_order(self.db, "me", self.aid, "b", "crypto:BTC", "sell", "market", 4, mark=113, now=self.start + 3 * 900)
        lim = sim.place_order(self.db, "me", self.aid, "c", "crypto:BTC", "sell", "limit", 6, price=200, now=self.start + 3 * 900)
        at(self.start + 6 * 900)
        sim.cancel_order(self.db, "me", self.aid, lim["id"], now=self.start + 6 * 900)
        self.assertNotEqual(self.state()["summary"], snap["summary"])
        sim.rewind(self.db, "me", self.aid, self.start + 3 * 900)
        again = self.state()
        self.assertEqual(sim.session(self.db, self.aid)["cursor"], self.start + 3 * 900)
        for k in ("summary", "positions", "orders", "ledger"):
            self.assertEqual(again[k], snap[k], k)
        sim.rewind(self.db, "me", self.aid, 0)  # before the start: clamps to the start, everything undone
        self.assertEqual((self.state()["summary"]["balance"], self.state()["positions"]), (10_000, []))

    def test_session_needs_history_on_both_sides_of_the_start(self):
        with self.assertRaises(ValueError):
            sim.create_replay(self.db, "me", "R", "crypto", "BTC", "15m", "USD", 1000, self.bars[12:], self.start)
        with self.assertRaises(ValueError):
            sim.create_replay(self.db, "me", "R", "crypto", "BTC", "15m", "USD", 1000, self.bars[:10], self.start)


if __name__ == "__main__":
    unittest.main()
