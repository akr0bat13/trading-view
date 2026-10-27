import hmac
import json
import os
import re
import threading
import time
from pathlib import Path

import requests
from flask import Blueprint, Flask, Response, jsonify, request

import data_source
import sim

app = Flask(__name__, static_folder="static", static_url_path="")
app.json.sort_keys = False  # keep SOURCES order in the market dropdown

# Local run: 127.0.0.1 without a password. Anywhere else (Railway sets RAILWAY_ENVIRONMENT, HOST=0.0.0.0) the app
# is reachable from the internet and its state API is writable, so it refuses to start without a password.
HOST = os.environ.get("HOST", "127.0.0.1")
AUTH_USER, AUTH_PASSWORD = os.environ.get("AUTH_USER", "admin"), os.environ.get("AUTH_PASSWORD", "")
if (HOST != "127.0.0.1" or "RAILWAY_ENVIRONMENT" in os.environ) and not AUTH_PASSWORD:
    raise RuntimeError("AUTH_PASSWORD must be set when the app is not bound to 127.0.0.1")


@app.before_request
def basic_auth():
    if not AUTH_PASSWORD:
        return None
    a = request.authorization
    if a and hmac.compare_digest(a.username or "", AUTH_USER) and hmac.compare_digest(a.password or "", AUTH_PASSWORD):
        return None
    return Response("login required", 401, {"WWW-Authenticate": 'Basic realm="trading-view"'})


@app.get("/")
def index():
    return app.send_static_file("index.html")


@app.get("/api/sources")
def sources():
    return jsonify(timeframes=data_source.TIMEFRAMES, sources={
        k: {key: v.get(key) for key in ("label", "symbols", "live")}
        for k, v in data_source.SOURCES.items()})


@app.get("/api/candles")
def candles():
    a = request.args
    try:
        before = a.get("before", type=int)
        return jsonify(data_source.get_candles(a["source"], a["symbol"].strip(), a.get("tf", "15m"), before))
    except KeyError as e:
        return jsonify(error=f"missing parameter {e}"), 400
    except Exception as e:  # upstream/network errors -> shown in the pane
        return jsonify(error=str(e)), 502


@app.get("/api/quotes")
def quotes():
    a = request.args
    symbols = [s.strip() for s in a.get("symbols", "").split(",") if s.strip()]
    try:
        return jsonify(data_source.get_quotes(a["source"], symbols))
    except KeyError as e:
        return jsonify(error=f"missing parameter {e}"), 400
    except Exception as e:
        return jsonify(error=str(e)), 502


@app.get("/api/bot/trades")
def bot_trades():
    """Trades of the paper bot from analytics-api, for the entry/exit arrows. The service token stays on the server."""
    base, token = os.environ.get("ANALYTICS_URL", "").rstrip("/"), os.environ.get("ANALYTICS_TOKEN", "")
    if not base or not token:
        return jsonify(error="ANALYTICS_URL and ANALYTICS_TOKEN are not set"), 503
    try:
        r = requests.get(f"{base}/api/v1/trader/trades", params={"limit": request.args.get("limit", 200, type=int)},
                         headers={"Authorization": f"Bearer {token}"}, timeout=10)
        r.raise_for_status()
        return jsonify(r.json())
    except (requests.RequestException, ValueError) as e:
        return jsonify(error=str(e)), 502


# UI state (settings, drawings, layouts, ...) lives in local JSON files under state/,
# so it survives browser changes and localhost vs 127.0.0.1.
STATE = Path(os.environ.get("STATE_DIR") or Path(__file__).with_name("state"))  # on Railway: a volume
STATE_LOCK = threading.Lock()
NAME = re.compile(r"^[a-z]{1,32}$")

STATE.mkdir(parents=True, exist_ok=True)
if Path(__file__).with_name("drawings.json").exists() and not (STATE / "drawings.json").exists():
    Path(__file__).with_name("drawings.json").replace(STATE / "drawings.json")  # pre-state/ location


@app.get("/api/state/<name>")
def get_state(name):
    f = STATE / f"{name}.json"
    if not NAME.match(name):
        return jsonify(error="bad name"), 400
    return app.response_class(f.read_text() if f.exists() else "null", mimetype="application/json")


@app.put("/api/state/<name>")
def put_state(name):
    if not NAME.match(name):
        return jsonify(error="bad name"), 400
    data = request.get_json(silent=True)
    with STATE_LOCK:
        tmp = STATE / f"{name}.tmp"
        tmp.write_text(json.dumps(data, indent=1))
        tmp.replace(STATE / f"{name}.json")  # atomic: a crash mid-write never leaves a half-written file
    return jsonify(ok=True)


# ---------- demo trading (virtual money only; sim.py has no broker code) ----------
DB = sim.connect(str(STATE / "trading.db"))
CURRENCY = {"crypto": "USD", "us": "USD", "ru": "RUB"}  # sources a demo account can trade, by quote currency
WHOLE_SHARES = {"us", "ru"}
STALE = 20 * 60  # Yahoo delays some quotes by 15 min; older than this = market closed or a data problem


def owner():
    return request.authorization.username if AUTH_PASSWORD else "local"


_bars = {}


def minute_bars(key):
    """1m candles of "source:SYMBOL" from the live data source, reused for 5 s; raises on data errors."""
    t, bars = _bars.get(key, (0, None))
    if time.time() - t > 5:
        source, symbol = key.split(":", 1)
        bars = data_source.get_candles(source, symbol, "1m")
        _bars[key] = (time.time(), bars)
    return bars


def sync(a):
    """Paper accounts fill lazily: every read runs the 1m bars closed since the last read through sim.on_bar.
    Returns {symbol: last price} and {symbol: data error}; a data error never fills anything."""
    now, marks, errors = int(time.time()), {}, {}
    keys = [r[0] for r in DB.execute("SELECT symbol FROM orders WHERE account_id = ? AND status = 'open' UNION "
                                     "SELECT symbol FROM positions WHERE account_id = ?", (a["id"], a["id"]))]
    for key in keys:  # ponytail: one upstream request per symbol per read, add a short cache if accounts hold many symbols
        try:
            bars = minute_bars(key)
        except Exception as e:
            errors[key] = str(e)
            continue
        if bars:
            marks[key] = bars[-1]["close"]
        for b in bars:
            if b["time"] >= a["checked_at"] and b["time"] + 60 <= now:
                sim.on_bar(DB, a["id"], key, b)
    if not errors:  # retry the failed symbol's bars next time instead of skipping them
        DB.execute("UPDATE accounts SET checked_at = ? WHERE id = ? AND checked_at < ?", (now - now % 60, a["id"], now - now % 60))
    return marks, errors


def fresh_mark(key):
    """Server-side price for a market order, or None when there is no recent one."""
    try:
        bars = minute_bars(key)
    except Exception:
        return None
    return bars[-1]["close"] if bars and time.time() - bars[-1]["time"] < STALE else None


def replay_of(a):
    r = a["mode"] == "replay" and sim.session(DB, a["id"])
    if not r:
        raise KeyError("replay session not found")
    return r


def clock(a, key):
    """(time, server price of key, do market orders fill right away). Paper: wall clock and the live price. Replay: the
    cursor and the last closed bar's close; its market orders wait for the next bar's open, like any order placed between bars."""
    if a["mode"] == "replay":
        r = replay_of(a)
        if key != f"{r['source']}:{r['symbol']}":
            raise ValueError(f"this replay trades {r['symbol']} only")
        return r["cursor"], sim.last_price(DB, a["id"]), False
    sync(a)  # fills due before this action happen first
    return int(time.time()), fresh_mark(key), True


def trading_state(account_id, **extra):
    a = sim.account(DB, owner(), account_id)
    if a["mode"] == "replay":
        r = replay_of(a)
        marks, errors, extra["replay"] = {f"{r['source']}:{r['symbol']}": sim.last_price(DB, a["id"])}, {}, dict(r)
    else:
        marks, errors = sync(a)
    return jsonify(**sim.snapshot(DB, sim.account(DB, owner(), account_id), marks), errors=errors, **extra)


def client_id(j):
    cid = str(j.get("client_order_id") or "")
    if not 8 <= len(cid) <= 64:
        raise ValueError("client_order_id (8-64 chars) is required")  # the retry key: the same id never trades twice
    return cid


trading = Blueprint("trading", __name__, url_prefix="/api/trading")


@trading.errorhandler(KeyError)
def not_found(e):
    return jsonify(error=str(e.args[0]) if e.args else "not found"), 404


@trading.errorhandler(ValueError)
def bad_request(e):
    return jsonify(error=str(e)), 400


@trading.get("/accounts")
def trading_accounts():
    return jsonify(sim.accounts(DB, owner()))


@trading.post("/accounts")
def trading_create():
    j = request.get_json(silent=True) or {}
    if j.get("currency") not in set(CURRENCY.values()):
        raise ValueError("currency must be one of " + ", ".join(sorted(set(CURRENCY.values()))))
    aid = sim.create_account(DB, owner(), j.get("name") or "", "paper", j["currency"], j.get("initial"),
                             fee_bps=j.get("fee_bps", 5), slippage_bps=j.get("slippage_bps", 2), now=int(time.time()))
    return trading_state(aid), 201


@trading.get("/accounts/<int:aid>")
def trading_get(aid):
    return trading_state(aid)


@trading.post("/accounts/<int:aid>/orders")
def trading_order(aid):
    """Body: {client_order_id, source, symbol, side, type, qty, price?}. Any price or balance the client sends besides
    a limit price is ignored: market orders fill at the server's own last price."""
    a = sim.account(DB, owner(), aid)
    j = request.get_json(silent=True) or {}
    cid, source, symbol, qty = client_id(j), j.get("source"), str(j.get("symbol") or "").strip(), j.get("qty")
    if CURRENCY.get(source) != a["currency"]:
        raise ValueError(f"this {a['currency']} account can't trade {source} instruments")
    if source in WHOLE_SHARES and isinstance(qty, (int, float)) and qty != int(qty):
        raise ValueError("stocks trade in whole shares")
    if not symbol or source not in data_source.SOURCES:
        raise ValueError("unknown instrument")
    key = f"{source}:{symbol}"
    now, mark, instant = clock(a, key)
    sim.place_order(DB, owner(), aid, cid, key, j.get("side"), j.get("type"), qty, price=j.get("price"), mark=mark, now=now,
                    fill_at=instant and j.get("type") == "market" and mark and sim.slipped(mark, j.get("side"), a["slippage_bps"]) or None)
    return trading_state(aid)


@trading.delete("/accounts/<int:aid>/orders/<int:oid>")
def trading_cancel(aid, oid):
    a = sim.account(DB, owner(), aid)
    sim.cancel_order(DB, owner(), aid, oid, now=replay_of(a)["cursor"] if a["mode"] == "replay" else int(time.time()))
    return trading_state(aid)


@trading.post("/accounts/<int:aid>/close")
def trading_close(aid):
    """Body: {client_order_id, symbol: "source:SYMBOL"}: market order for the whole position."""
    a, j = sim.account(DB, owner(), aid), request.get_json(silent=True) or {}
    key = str(j.get("symbol"))
    now, mark, instant = clock(a, key)
    p = sim.position(DB, aid, key)
    if p is None:
        raise ValueError("no open position")
    side = "sell" if p["qty"] > 0 else "buy"
    sim.place_order(DB, owner(), aid, client_id(j), key, side, "market", abs(p["qty"]), mark=mark,
                    now=now, fill_at=instant and mark and sim.slipped(mark, side, a["slippage_bps"]) or None)
    return trading_state(aid)


@trading.put("/accounts/<int:aid>/exits")
def trading_exits(aid):
    """Body: {symbol: "source:SYMBOL", sl, tp}; null removes a level."""
    a, j = sim.account(DB, owner(), aid), request.get_json(silent=True) or {}
    key = str(j.get("symbol"))
    now, mark, _ = clock(a, key)
    sim.set_exits(DB, owner(), aid, key, mark, j.get("sl"), j.get("tp"), now=now)
    return trading_state(aid)


# ---------- replay: the server owns the simulated time; bars after the cursor never leave it ----------
REPLAY_BARS = 20000  # bars after the start downloaded per session (a year of 30m, ~2 weeks of 1m)


@trading.post("/replays")
def replay_create():
    """Body: {name, source, symbol, tf, start (unix s), initial, fee_bps, slippage_bps}."""
    j = request.get_json(silent=True) or {}
    source, symbol, tf, start = j.get("source"), str(j.get("symbol") or "").strip(), j.get("tf"), j.get("start")
    if source not in CURRENCY:
        raise ValueError("replay supports crypto, US stocks and MOEX")
    if tf not in sim.TF_SECONDS or tf == "1w":
        raise ValueError("pick a timeframe from 1m to 1d")
    now = int(time.time())
    if not isinstance(start, int) or not 0 < start < now - 86400:
        raise ValueError("pick a start at least a day in the past")
    start -= start % sim.TF_SECONDS[tf]
    try:
        bars = data_source.history(source, symbol, tf, start, min(now, start + REPLAY_BARS * sim.TF_SECONDS[tf]))
    except ValueError:
        raise
    except Exception as e:
        return jsonify(error=f"could not load history: {e}"), 502
    if bars and bars[0]["time"] > start:
        raise ValueError(f"{symbol} {tf} history is only available from {time.strftime('%Y-%m-%d %H:%M', time.gmtime(bars[0]['time']))} UTC")
    aid = sim.create_replay(DB, owner(), j.get("name") or f"Replay {symbol} {tf}", source, symbol, tf, CURRENCY[source], j.get("initial"), bars, start,
                            fee_bps=j.get("fee_bps", 5), slippage_bps=j.get("slippage_bps", 2))
    return trading_state(aid), 201


@trading.get("/replays/<int:aid>/bars")
def replay_bars(aid):
    replay_of(sim.account(DB, owner(), aid))
    return jsonify(sim.known_bars(DB, aid, request.args.get("tf", ""), request.args.get("before", type=int)))


@trading.post("/replays/<int:aid>/step")
def replay_step(aid):
    """Body: {n, tf}: close the next n bars. Answers with the account and the chart's last bars at tf."""
    j = request.get_json(silent=True) or {}
    n = j.get("n", 1)
    if not isinstance(n, int) or not 1 <= n <= 5000:
        raise ValueError("n must be 1..5000")
    stepped = sim.step(DB, owner(), aid, n)
    return trading_state(aid, stepped=stepped, bars=sim.known_bars(DB, aid, j.get("tf", ""), limit=3))


@trading.post("/replays/<int:aid>/seek")
def replay_seek(aid):
    """Body: {time}: forward runs every bar on the way through the account; back rewinds the account to that moment."""
    a, t = sim.account(DB, owner(), aid), (request.get_json(silent=True) or {}).get("time")
    r = replay_of(a)
    if not isinstance(t, int):
        raise ValueError("time (unix seconds) is required")
    if t < r["cursor"]:
        sim.rewind(DB, owner(), aid, t)
    else:
        n = DB.execute("SELECT COUNT(*) FROM bars WHERE account_id = ? AND time >= ? AND time + ? <= ?",
                       (aid, r["cursor"], sim.TF_SECONDS[r["tf"]], t)).fetchone()[0]
        sim.step(DB, owner(), aid, n)
    return trading_state(aid)


@trading.put("/replays/<int:aid>")
def replay_settings(aid):
    """Body: {speed}: remembered so a reopened session plays at the same speed."""
    replay_of(sim.account(DB, owner(), aid))
    speed = (request.get_json(silent=True) or {}).get("speed")
    if speed not in (1, 2, 5, 10):
        raise ValueError("speed must be 1, 2, 5 or 10")
    DB.execute("UPDATE replay SET speed = ? WHERE account_id = ?", (speed, aid))
    return trading_state(aid)


app.register_blueprint(trading)


if __name__ == "__main__":
    # 5050, not 5000: macOS AirPlay Receiver occupies port 5000
    app.run(host=HOST, port=int(os.environ.get("PORT", 5050)), threaded=True)
