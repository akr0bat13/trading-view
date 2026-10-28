"""Virtual execution engine for paper and replay trading (see docs/trading.md).

There is no broker or exchange client here and none may be added: every fill is computed from candles or from a
price the server itself fetched from data_source. Money lives in SQLite ($STATE_DIR/trading.db); each order, fill,
position change and ledger entry is written in one transaction, and every read and write is scoped to its owner.

Account model: linear instruments in the account currency, long and short, no leverage (margin = |qty| * avg_price).
balance = initial + realized PnL - fees;  equity = balance + unrealized;  free = equity - margin - reserved by open limits.
"""
import math
import sqlite3
from contextlib import contextmanager

SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('paper', 'replay')), currency TEXT NOT NULL,
  initial REAL NOT NULL, cash REAL NOT NULL, fee_bps REAL NOT NULL, slippage_bps REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', created_at INTEGER NOT NULL,
  checked_at INTEGER NOT NULL DEFAULT 0);  -- paper: market bars up to here have been run through on_bar()
CREATE TABLE IF NOT EXISTS replay (  -- one replay session per replay account
  account_id INTEGER PRIMARY KEY REFERENCES accounts ON DELETE CASCADE,
  source TEXT NOT NULL, symbol TEXT NOT NULL, tf TEXT NOT NULL,
  start INTEGER NOT NULL, end INTEGER NOT NULL, cursor INTEGER NOT NULL, speed REAL NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS bars (  -- historical market data frozen for a replay session, never mixed with fills
  account_id INTEGER NOT NULL REFERENCES accounts ON DELETE CASCADE, time INTEGER NOT NULL,
  open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL, volume REAL NOT NULL,
  PRIMARY KEY (account_id, time));
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts ON DELETE CASCADE,
  client_order_id TEXT NOT NULL, symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')), type TEXT NOT NULL CHECK (type IN ('market', 'limit')),
  qty REAL NOT NULL, price REAL, status TEXT NOT NULL CHECK (status IN ('open', 'filled', 'cancelled', 'rejected')),
  reason TEXT, created_at INTEGER NOT NULL, closed_at INTEGER,  -- closed_at: when filled or cancelled (replay rewinds by it)
  UNIQUE (account_id, client_order_id));  -- a retried request finds its order instead of making a second one
CREATE TABLE IF NOT EXISTS fills (
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL UNIQUE REFERENCES orders ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts ON DELETE CASCADE, symbol TEXT NOT NULL, side TEXT NOT NULL,
  qty REAL NOT NULL, price REAL NOT NULL, fee REAL NOT NULL, realized REAL NOT NULL, time INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS positions (  -- qty < 0 is a short
  account_id INTEGER NOT NULL REFERENCES accounts ON DELETE CASCADE, symbol TEXT NOT NULL,
  qty REAL NOT NULL, avg_price REAL NOT NULL, sl REAL, tp REAL,
  since INTEGER NOT NULL DEFAULT 0,  -- SL/TP only look at bars from here on (position opened or exits changed)
  PRIMARY KEY (account_id, symbol));
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('deposit', 'fee', 'pnl')), delta REAL NOT NULL, balance_after REAL NOT NULL,
  fill_id INTEGER REFERENCES fills ON DELETE CASCADE, time INTEGER NOT NULL);
"""


# columns added to SCHEMA after the first release; keep in step with SCHEMA
LATER_COLUMNS = (("orders", "closed_at", "INTEGER"), ("accounts", "checked_at", "INTEGER NOT NULL DEFAULT 0"),
                 ("positions", "since", "INTEGER NOT NULL DEFAULT 0"))


def connect(path):
    db = sqlite3.connect(path, isolation_level=None, check_same_thread=False)  # transactions are explicit, see tx()
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    db.execute("PRAGMA journal_mode = WAL")
    db.executescript(SCHEMA)
    for table, col, ddl in LATER_COLUMNS:  # CREATE IF NOT EXISTS leaves a database made by an older version without these
        if col not in {r["name"] for r in db.execute(f"PRAGMA table_info({table})")}:
            db.execute(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}")
    return db


@contextmanager
def tx(db):
    db.execute("BEGIN IMMEDIATE")  # takes the write lock up front: two requests can't both spend the same cash
    try:
        yield
    except BaseException:
        db.execute("ROLLBACK")
        raise
    db.execute("COMMIT")


# ---------- pure execution rules ----------

def slipped(price, side, bps):
    """Market orders and stop losses fill worse by bps: buys higher, sells lower."""
    return price * (1 + bps / 1e4) if side == "buy" else price * (1 - bps / 1e4)


def apply_fill(qty, avg, delta, price):
    """Position (qty, avg) after a signed fill of delta at price -> (qty, avg, realized PnL of the closed part)."""
    if qty == 0 or (qty > 0) == (delta > 0):
        new = qty + delta
        return new, (abs(qty) * avg + abs(delta) * price) / abs(new), 0.0
    closed = min(abs(qty), abs(delta))
    realized = closed * (price - avg) * (1 if qty > 0 else -1)
    new = qty + delta
    if abs(new) < 1e-12:
        return 0.0, 0.0, realized
    return new, avg if (new > 0) == (qty > 0) else price, realized  # flipped: the remainder opened at this price


def match(order, bar, slippage_bps):
    """Fill price of an open order on a bar, or None. Only bars that opened at or after the order was placed count,
    so the bar the order was placed on (already known to the trader) can never fill it.
    OHLC does not tell the path inside a bar: a limit fills if the bar touches its price, at the open if the bar gapped through it."""
    if bar["time"] < order["created_at"]:
        return None
    if order["type"] == "market":
        return slipped(bar["open"], order["side"], slippage_bps)
    p = order["price"]
    if order["side"] == "buy":
        return min(bar["open"], p) if bar["low"] <= p else None
    return max(bar["open"], p) if bar["high"] >= p else None


def exit_hit(qty, sl, tp, bar, slippage_bps):
    """(price, 'sl' | 'tp') when a bar triggers the position's stop loss or take profit, else None.
    Both inside one bar: the stop loss is assumed first (the conservative reading). A gap past the level fills at the open."""
    if not qty:
        return None
    long, o = qty > 0, bar["open"]
    side = "sell" if long else "buy"
    if sl is not None and (bar["low"] <= sl if long else bar["high"] >= sl):
        return slipped(min(o, sl) if long else max(o, sl), side, slippage_bps), "sl"
    if tp is not None and (bar["high"] >= tp if long else bar["low"] <= tp):
        return (max(o, tp) if long else min(o, tp)), "tp"
    return None


def _num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) and x > 0


def check_order(side, type_, qty, price, ref):
    """Reason the order is malformed, or None. ref = the price it would fill at (limit price or server mark)."""
    if side not in ("buy", "sell"):
        return "side must be buy or sell"
    if type_ not in ("market", "limit"):
        return "type must be market or limit"
    if not _num(qty):
        return "quantity must be a positive number"
    if type_ == "limit" and not _num(price):
        return "limit price must be a positive number"
    if not _num(ref):
        return "no market price"  # data error: reject rather than fill at a made-up price
    return None


# ---------- storage ----------

def account(db, owner, account_id):
    a = db.execute("SELECT * FROM accounts WHERE id = ? AND owner = ?", (account_id, owner)).fetchone()
    if a is None:
        raise KeyError("account not found")  # someone else's account looks exactly like a missing one
    return a


def active(db, owner, account_id):
    """The account, if it can still trade: an ended replay session is read-only."""
    a = account(db, owner, account_id)
    if a["status"] != "active":
        raise ValueError("this session has ended: reset it to trade again")
    return a


def create_account(db, owner, name, mode, currency, initial, fee_bps=5.0, slippage_bps=2.0, now=0):
    if not _num(initial):
        raise ValueError("initial capital must be a positive number")
    if not all(isinstance(x, (int, float)) and 0 <= x <= 1000 for x in (fee_bps, slippage_bps)):
        raise ValueError("fee and slippage must be between 0 and 1000 bps")
    if not (isinstance(name, str) and name.strip()):
        raise ValueError("name is required")
    with tx(db):
        return _insert_account(db, owner, name, mode, currency, initial, fee_bps, slippage_bps, now)


def _insert_account(db, owner, name, mode, currency, initial, fee_bps, slippage_bps, now):
    aid = db.execute("INSERT INTO accounts (owner, name, mode, currency, initial, cash, fee_bps, slippage_bps, created_at, checked_at)"
                     " VALUES (?,?,?,?,?,?,?,?,?,?)", (owner, name.strip(), mode, currency, initial, initial, fee_bps, slippage_bps, now, now)).lastrowid
    db.execute("INSERT INTO ledger (account_id, kind, delta, balance_after, time) VALUES (?, 'deposit', ?, ?, ?)", (aid, initial, initial, now))
    return aid


def summary(db, a, marks):
    """Balance figures; marks = {symbol: last price}, positions without a mark are valued at their average price."""
    unreal = margin = 0.0
    for p in db.execute("SELECT * FROM positions WHERE account_id = ?", (a["id"],)):
        unreal += p["qty"] * (marks.get(p["symbol"], p["avg_price"]) - p["avg_price"])
        margin += abs(p["qty"]) * p["avg_price"]
    reserved = db.execute("SELECT COALESCE(SUM(qty * price), 0) FROM orders WHERE account_id = ? AND status = 'open' AND type = 'limit'",
                          (a["id"],)).fetchone()[0]  # ponytail: reserves every open limit in full, even ones that would only reduce a position
    equity = a["cash"] + unreal
    return {"balance": a["cash"], "equity": equity, "unrealized": unreal, "realized": a["cash"] - a["initial"] + fees_paid(db, a["id"]),
            "margin": margin, "reserved": reserved, "free": equity - margin - reserved}


def fees_paid(db, account_id):
    return -db.execute("SELECT COALESCE(SUM(delta), 0) FROM ledger WHERE account_id = ? AND kind = 'fee'", (account_id,)).fetchone()[0]


def position(db, account_id, symbol):
    return db.execute("SELECT * FROM positions WHERE account_id = ? AND symbol = ?", (account_id, symbol)).fetchone()


def place_order(db, owner, account_id, client_order_id, symbol, side, type_, qty, price=None, mark=None, now=0, fill_at=None):
    """Store an order; returns it as a dict. The same client_order_id again returns the first order untouched.
    mark = the server's own current price (never the client's). fill_at = fill price for an immediate market fill
    (paper trading); without it the order stays open until match() fills it on a later bar."""
    with tx(db):
        a = active(db, owner, account_id)
        dup = db.execute("SELECT * FROM orders WHERE account_id = ? AND client_order_id = ?", (a["id"], client_order_id)).fetchone()
        if dup:
            return dict(dup)
        ref = price if type_ == "limit" else mark
        reason = check_order(side, type_, qty, price, ref)
        if not reason:
            pos = position(db, a["id"], symbol)
            q = pos["qty"] if pos else 0.0
            added = max(0.0, abs(q + (qty if side == "buy" else -qty)) - abs(q)) * ref  # reducing a position needs no margin
            need, free = added + abs(qty) * ref * a["fee_bps"] / 1e4, summary(db, a, {symbol: mark} if mark else {})["free"]
            if need > free + 1e-9:
                reason = f"insufficient funds: needs {need:,.2f}, free {free:,.2f} {a['currency']}"
        oid = db.execute("INSERT INTO orders (account_id, client_order_id, symbol, side, type, qty, price, status, reason, created_at)"
                         " VALUES (?,?,?,?,?,?,?,?,?,?)", (a["id"], client_order_id, symbol, side, type_, qty, price if type_ == "limit" else None,
                                                           "rejected" if reason else "open", reason, now)).lastrowid
        if not reason and fill_at is not None:
            _fill(db, oid, fill_at, now)
        return dict(db.execute("SELECT * FROM orders WHERE id = ?", (oid,)).fetchone())


def fill(db, order_id, price, now):
    """Execute an open order at price. A second call for the same order does nothing and returns None."""
    with tx(db):
        return _fill(db, order_id, price, now)


def _fill(db, order_id, price, now):
    o = db.execute("SELECT * FROM orders WHERE id = ? AND status = 'open'", (order_id,)).fetchone()
    if o is None:
        return None
    a = db.execute("SELECT * FROM accounts WHERE id = ?", (o["account_id"],)).fetchone()
    pos = position(db, a["id"], o["symbol"])
    q, avg = (pos["qty"], pos["avg_price"]) if pos else (0.0, 0.0)
    new_q, new_avg, realized = apply_fill(q, avg, o["qty"] if o["side"] == "buy" else -o["qty"], price)
    fee = o["qty"] * price * a["fee_bps"] / 1e4
    fid = db.execute("INSERT INTO fills (order_id, account_id, symbol, side, qty, price, fee, realized, time) VALUES (?,?,?,?,?,?,?,?,?)",
                     (o["id"], a["id"], o["symbol"], o["side"], o["qty"], price, fee, realized, now)).lastrowid
    cash = a["cash"]
    for kind, delta in (("pnl", realized), ("fee", -fee)):
        if delta:
            cash += delta
            db.execute("INSERT INTO ledger (account_id, kind, delta, balance_after, fill_id, time) VALUES (?,?,?,?,?,?)",
                       (a["id"], kind, delta, cash, fid, now))
    db.execute("UPDATE accounts SET cash = ? WHERE id = ?", (cash, a["id"]))
    if new_q == 0:
        db.execute("DELETE FROM positions WHERE account_id = ? AND symbol = ?", (a["id"], o["symbol"]))
    elif pos and (new_q > 0) == (q > 0):  # same direction: SL/TP stay
        db.execute("UPDATE positions SET qty = ?, avg_price = ? WHERE account_id = ? AND symbol = ?", (new_q, new_avg, a["id"], o["symbol"]))
    else:  # new or flipped position: old SL/TP no longer make sense
        db.execute("INSERT OR REPLACE INTO positions (account_id, symbol, qty, avg_price, since) VALUES (?,?,?,?,?)", (a["id"], o["symbol"], new_q, new_avg, now))
    db.execute("UPDATE orders SET status = 'filled', closed_at = ? WHERE id = ?", (now, o["id"]))
    return fid


def cancel_order(db, owner, account_id, order_id, now=0):
    """True if an open order was cancelled; filled, rejected and already cancelled orders stay as they are."""
    with tx(db):
        active(db, owner, account_id)
        return db.execute("UPDATE orders SET status = 'cancelled', closed_at = ? WHERE id = ? AND account_id = ? AND status = 'open'",
                          (now, order_id, account_id)).rowcount == 1


def set_exits(db, owner, account_id, symbol, mark, sl=None, tp=None, now=0):
    """Attach stop loss / take profit (None removes one) to an open position. Levels are checked against the current
    price, not the entry, so a stop can trail into profit; a level that would trigger right away is refused."""
    with tx(db):
        active(db, owner, account_id)
        p = position(db, account_id, symbol)
        if p is None:
            raise ValueError("no open position")
        long = p["qty"] > 0
        if not _num(mark):
            raise ValueError("no market price")
        if sl is not None and not (_num(sl) and (sl < mark if long else sl > mark)):
            raise ValueError("stop loss must be " + ("below" if long else "above") + " the current price")
        if tp is not None and not (_num(tp) and (tp > mark if long else tp < mark)):
            raise ValueError("take profit must be " + ("above" if long else "below") + " the current price")
        db.execute("UPDATE positions SET sl = ?, tp = ?, since = ? WHERE account_id = ? AND symbol = ?", (sl, tp, now, account_id, symbol))


def on_bar(db, account_id, symbol, bar):
    """Run one closed bar of `symbol` through the account: open orders first, then the position's SL/TP.
    Fills are stamped with the bar's open time (when inside the bar it happened is unknown). Safe to repeat for a bar."""
    with tx(db):
        _on_bar(db, account_id, symbol, bar)


def _on_bar(db, account_id, symbol, bar):
    slip = db.execute("SELECT slippage_bps FROM accounts WHERE id = ?", (account_id,)).fetchone()[0]
    for o in db.execute("SELECT * FROM orders WHERE account_id = ? AND symbol = ? AND status = 'open' ORDER BY id", (account_id, symbol)).fetchall():
        price = match(o, bar, slip)
        if price is not None:
            _fill(db, o["id"], price, bar["time"])
    p = position(db, account_id, symbol)
    hit = p and bar["time"] >= p["since"] and exit_hit(p["qty"], p["sl"], p["tp"], bar, slip)
    if hit:
        price, kind = hit
        oid = db.execute("INSERT INTO orders (account_id, client_order_id, symbol, side, type, qty, status, reason, created_at)"
                         " VALUES (?,?,?,?,'market',?,'open',?,?)", (account_id, f"{kind}:{symbol}:{bar['time']}", symbol,
                                                                     "sell" if p["qty"] > 0 else "buy", abs(p["qty"]),
                                                                     "stop loss" if kind == "sl" else "take profit", bar["time"])).lastrowid
        _fill(db, oid, price, bar["time"])


def accounts(db, owner):
    return [dict(a) for a in db.execute("SELECT * FROM accounts WHERE owner = ? ORDER BY id", (owner,))]


def snapshot(db, a, marks):
    """Everything the trading panel shows for one account."""
    rows = lambda sql: [dict(r) for r in db.execute(sql, (a["id"],))]  # noqa: E731
    positions = rows("SELECT * FROM positions WHERE account_id = ? ORDER BY symbol")
    for p in positions:
        p["mark"] = marks.get(p["symbol"])
        p["unrealized"] = p["qty"] * (p["mark"] - p["avg_price"]) if p["mark"] else None
    return {"account": dict(a), "summary": {**summary(db, a, marks), "fees": fees_paid(db, a["id"])}, "positions": positions,
            "orders": rows("SELECT * FROM orders WHERE account_id = ? AND status = 'open' ORDER BY id DESC"),
            "history": rows("SELECT o.*, f.price AS fill_price, f.fee, f.realized, f.time AS fill_time FROM orders o"
                            " LEFT JOIN fills f ON f.order_id = o.id WHERE o.account_id = ? AND o.status != 'open' ORDER BY o.id DESC LIMIT 200"),
            "ledger": rows("SELECT * FROM ledger WHERE account_id = ? ORDER BY id DESC LIMIT 200")}


# ---------- replay ----------
# A replay account owns one session: historical bars of one instrument frozen in `bars` at creation, and a cursor.
# Bars whose close time (time + tf) is at or before the cursor are known; nothing later ever leaves the server.

TF_SECONDS = {"1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "1d": 86400, "1w": 604800}


def create_replay(db, owner, name, source, symbol, tf, currency, initial, bars, start, fee_bps=5.0, slippage_bps=2.0):
    """bars: history of the instrument at tf, including some warm-up before start. The cursor starts at start."""
    known = [b for b in bars if b["time"] + TF_SECONDS[tf] <= start]
    ahead = [b for b in bars if b["time"] >= start]
    if not known or not ahead:
        raise ValueError(f"no {symbol} {tf} history around the chosen start" + (f"; it begins {bars[0]['time']}" if bars else ""))
    # same checks as create_account, but one transaction for the account, the session and its bars
    if not _num(initial) or not all(isinstance(x, (int, float)) and 0 <= x <= 1000 for x in (fee_bps, slippage_bps)) or not str(name).strip():
        raise ValueError("name, a positive capital and fee/slippage between 0 and 1000 bps are required")
    with tx(db):
        aid = _insert_account(db, owner, str(name), "replay", currency, initial, fee_bps, slippage_bps, start)
        db.execute("INSERT INTO replay (account_id, source, symbol, tf, start, end, cursor) VALUES (?,?,?,?,?,?,?)",
                   (aid, source, symbol, tf, start, bars[-1]["time"] + TF_SECONDS[tf], start))
        db.executemany("INSERT OR IGNORE INTO bars VALUES (?,?,?,?,?,?,?)",
                       [(aid, b["time"], b["open"], b["high"], b["low"], b["close"], b.get("volume") or 0) for b in bars])
    return aid


def session(db, account_id):
    return db.execute("SELECT * FROM replay WHERE account_id = ?", (account_id,)).fetchone()


def bucket(t, tf):
    if tf == "1w":
        return t - (t - 345600) % 604800  # weeks start on Monday (the epoch was a Thursday)
    return t - t % TF_SECONDS[tf]


def known_bars(db, account_id, tf, before=None, limit=1000):
    """Bars known at the cursor, aggregated to tf (>= the session's tf). The last one may still be forming, built only
    from closed base bars, exactly like a live chart's current candle."""
    r = session(db, account_id)
    if tf not in TF_SECONDS or TF_SECONDS[tf] < TF_SECONDS[r["tf"]]:
        raise ValueError(f"this replay runs on {r['tf']} bars: pick {r['tf']} or a higher timeframe")
    rows = db.execute("SELECT * FROM bars WHERE account_id = ? AND time + ? <= ? AND time < ? ORDER BY time",
                      (account_id, TF_SECONDS[r["tf"]], r["cursor"], bucket(before, tf) if before else r["cursor"])).fetchall()
    out = []
    for b in rows:
        t = bucket(b["time"], tf)
        if out and out[-1]["time"] == t:
            o = out[-1]
            o["high"], o["low"], o["close"], o["volume"] = max(o["high"], b["high"]), min(o["low"], b["low"]), b["close"], o["volume"] + b["volume"]
        else:
            out.append({"time": t, "open": b["open"], "high": b["high"], "low": b["low"], "close": b["close"], "volume": b["volume"]})
    return out[-limit:]


def last_price(db, account_id):
    """Close of the last known bar: the replay's "current price"."""
    r = session(db, account_id)
    row = db.execute("SELECT close FROM bars WHERE account_id = ? AND time + ? <= ? ORDER BY time DESC LIMIT 1",
                     (account_id, TF_SECONDS[r["tf"]], r["cursor"])).fetchone()
    return row and row[0]


def step(db, owner, account_id, n=1):
    """Advance n bars: each bar that closes is run through on_bar() before it becomes visible. Returns bars stepped."""
    active(db, owner, account_id)
    r = session(db, account_id)
    key, done = f"{r['source']}:{r['symbol']}", 0
    for b in db.execute("SELECT * FROM bars WHERE account_id = ? AND time >= ? ORDER BY time LIMIT ?", (account_id, r["cursor"], n)).fetchall():
        with tx(db):  # the bar's fills and the cursor move together
            _on_bar(db, account_id, key, dict(b))
            db.execute("UPDATE replay SET cursor = ? WHERE account_id = ?", (b["time"] + TF_SECONDS[r["tf"]], account_id))
        done += 1
    return done


def rewind(db, owner, account_id, t):
    """Go back to time t: the account becomes what it was at t. Orders placed, filled or cancelled at or after t are
    undone and positions and cash are rebuilt from the fills that remain. SL/TP levels are not versioned and are cleared."""
    a = active(db, owner, account_id)
    r = session(db, account_id)
    t = max(r["start"], min(t, r["cursor"]))
    t -= (t - r["start"]) % TF_SECONDS[r["tf"]]  # land on a bar boundary
    with tx(db):
        db.execute("DELETE FROM fills WHERE account_id = ? AND time >= ?", (account_id, t))  # their ledger rows go with them
        db.execute("DELETE FROM orders WHERE account_id = ? AND created_at >= ?", (account_id, t))
        db.execute("UPDATE orders SET status = 'open', closed_at = NULL WHERE account_id = ? AND closed_at >= ?", (account_id, t))
        db.execute("DELETE FROM positions WHERE account_id = ?", (account_id,))
        pos = {}
        for f in db.execute("SELECT * FROM fills WHERE account_id = ? ORDER BY time, id", (account_id,)).fetchall():
            q, avg, _ = pos.get(f["symbol"], (0.0, 0.0, 0))
            q, avg, _ = apply_fill(q, avg, f["qty"] if f["side"] == "buy" else -f["qty"], f["price"])
            pos[f["symbol"]] = (q, avg, f["time"])
        db.executemany("INSERT INTO positions (account_id, symbol, qty, avg_price, since) VALUES (?,?,?,?,?)",
                       [(account_id, k, q, avg, since) for k, (q, avg, since) in pos.items() if q])
        cash = db.execute("SELECT SUM(delta) FROM ledger WHERE account_id = ?", (account_id,)).fetchone()[0]
        db.execute("UPDATE accounts SET cash = ? WHERE id = ?", (cash if cash is not None else a["initial"], account_id))
        db.execute("UPDATE replay SET cursor = ? WHERE account_id = ?", (t, account_id))


# ---------- end, reset, report ----------

def end_session(db, owner, account_id, now):
    """Freeze the account: open orders are cancelled, positions stay valued at the last price, nothing trades any more."""
    with tx(db):
        active(db, owner, account_id)
        db.execute("UPDATE orders SET status = 'cancelled', reason = 'session ended', closed_at = ? WHERE account_id = ? AND status = 'open'",
                   (now, account_id))
        db.execute("UPDATE accounts SET status = 'ended' WHERE id = ?", (account_id,))


def reset(db, owner, account_id, now):
    """Back to the initial capital: this account's orders, fills, positions and ledger are deleted, a replay returns to
    its start. Other accounts are untouched. now: the new deposit's time (a replay passes its start)."""
    with tx(db):
        a = account(db, owner, account_id)
        for table in ("ledger", "fills", "orders", "positions"):
            db.execute(f"DELETE FROM {table} WHERE account_id = ?", (account_id,))
        db.execute("UPDATE accounts SET cash = initial, status = 'active', checked_at = ? WHERE id = ?", (now, account_id))
        db.execute("INSERT INTO ledger (account_id, kind, delta, balance_after, time) VALUES (?, 'deposit', ?, ?, ?)", (account_id, a["initial"], a["initial"], now))
        db.execute("UPDATE replay SET cursor = start WHERE account_id = ?", (account_id,))


def round_trips(fills):
    """Fills -> trades: a trade opens when a position leaves zero and closes when it returns to zero or flips.
    pnl is net of every fee paid inside it. Returns (closed trades, still open trades by symbol)."""
    done, live = [], {}
    for f in fills:
        t = live.get(f["symbol"]) or {"symbol": f["symbol"], "side": "long" if f["side"] == "buy" else "short", "opened": f["time"],
                                      "qty": 0.0, "avg": 0.0, "size": 0.0, "pnl": 0.0, "fees": 0.0}
        live[f["symbol"]] = t
        q, avg, realized = apply_fill(t["qty"], t["avg"], f["qty"] if f["side"] == "buy" else -f["qty"], f["price"])
        t["pnl"] += realized - f["fee"]
        t["fees"] += f["fee"]
        if q == 0 or (t["qty"] and (q > 0) != (t["qty"] > 0)):  # flat, or flipped through zero: the fill's fee stays with the closed trade
            done.append({"symbol": t["symbol"], "side": t["side"], "qty": t["size"], "entry": t["avg"], "exit": f["price"],
                         "opened": t["opened"], "closed": f["time"], "pnl": t["pnl"], "fees": t["fees"]})
            del live[f["symbol"]]
            if q:
                live[f["symbol"]] = {"symbol": f["symbol"], "side": "long" if q > 0 else "short", "opened": f["time"],
                                     "qty": q, "avg": avg, "size": abs(q), "pnl": 0.0, "fees": 0.0}
        else:
            t["qty"], t["avg"], t["size"] = q, avg, max(t["size"], abs(q))
    return done, live


def drawdown(curve):
    """Largest peak-to-trough fall of an equity curve [(time, equity)] -> (amount, fraction of the peak)."""
    peak, worst = -math.inf, (0.0, 0.0)
    for _, e in curve:
        peak = max(peak, e)
        if peak - e > worst[0]:
            worst = (peak - e, (peak - e) / peak if peak > 0 else 0.0)
    return worst


def report(db, a, marks, now):
    """Session results. Replay: equity is marked to every known bar's close, plus a buy-and-hold benchmark.
    Paper: the curve is the balance after each fill (realized only) ending at today's equity."""
    aid, s = a["id"], summary(db, a, marks)
    fills = [dict(f) for f in db.execute("SELECT * FROM fills WHERE account_id = ? ORDER BY time, id", (aid,))]
    trades, live = round_trips(fills)
    r = a["mode"] == "replay" and session(db, aid)
    benchmark = None
    if r:
        tf = TF_SECONDS[r["tf"]]
        bars = db.execute("SELECT * FROM bars WHERE account_id = ? AND time >= ? AND time + ? <= ? ORDER BY time",
                          (aid, r["start"], tf, r["cursor"])).fetchall()
        curve, cash, q, avg, i, held = [(r["start"], a["initial"])], a["initial"], 0.0, 0.0, 0, 0
        for b in bars:
            while i < len(fills) and fills[i]["time"] <= b["time"]:  # fills are stamped with the open of their bar
                f = fills[i]
                q, avg, realized = apply_fill(q, avg, f["qty"] if f["side"] == "buy" else -f["qty"], f["price"])
                cash += realized - f["fee"]
                i += 1
            held += q != 0
            curve.append((b["time"] + tf, cash + q * (b["close"] - avg)))
        in_market = held / len(bars) if bars else 0.0
        start, end = r["start"], r["cursor"]
        if bars:
            benchmark = {"return_pct": bars[-1]["close"] / bars[0]["open"] - 1, "pnl": a["initial"] * (bars[-1]["close"] / bars[0]["open"] - 1)}
    else:
        curve = [(a["created_at"], a["initial"])] + [(row["time"], row["balance_after"]) for row in
                 db.execute("SELECT time, balance_after FROM ledger WHERE account_id = ? AND kind != 'deposit' ORDER BY id", (aid,))]
        curve.append((now, s["equity"]))
        start, end = a["created_at"], now
        busy = sum(t["closed"] - t["opened"] for t in trades) + sum(now - t["opened"] for t in live.values())
        in_market = min(1.0, busy / (end - start)) if end > start else 0.0  # ponytail: overlapping trades in several symbols count twice, capped at 100%
    wins, losses = [t["pnl"] for t in trades if t["pnl"] > 0], [t["pnl"] for t in trades if t["pnl"] < 0]
    dd, dd_pct = drawdown(curve)
    step = max(1, len(curve) // 400)
    return {"start": start, "end": end, "status": a["status"], "currency": a["currency"],
            "initial": a["initial"], "equity": s["equity"], "pnl": s["equity"] - a["initial"], "return_pct": s["equity"] / a["initial"] - 1,
            "realized": s["realized"], "unrealized": s["unrealized"], "fees": fees_paid(db, aid),
            "trades": len(trades), "open_trades": len(live), "win_rate": len(wins) / len(trades) if trades else None,
            "avg_win": sum(wins) / len(wins) if wins else None, "avg_loss": sum(losses) / len(losses) if losses else None,
            "profit_factor": sum(wins) / -sum(losses) if losses else None,  # None with no losing trade (infinite or undefined)
            "max_drawdown": dd, "max_drawdown_pct": dd_pct, "time_in_market": in_market, "buy_and_hold": benchmark,
            "curve": curve[::step] + ([curve[-1]] if (len(curve) - 1) % step else []), "trade_list": trades[::-1][:500]}
