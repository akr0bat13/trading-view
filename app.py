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


def trading_state(account_id):
    a = sim.account(DB, owner(), account_id)
    marks, errors = sync(a)
    return jsonify(**sim.snapshot(DB, sim.account(DB, owner(), account_id), marks), errors=errors)


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
    sync(a)  # fills due before this order happen first
    mark = fresh_mark(key) if j.get("type") == "market" else None
    sim.place_order(DB, owner(), aid, cid, key, j.get("side"), j.get("type"), qty, price=j.get("price"),
                        mark=mark, now=int(time.time()), fill_at=mark and sim.slipped(mark, j.get("side"), a["slippage_bps"]))
    return trading_state(aid)


@trading.delete("/accounts/<int:aid>/orders/<int:oid>")
def trading_cancel(aid, oid):
    sim.cancel_order(DB, owner(), aid, oid)
    return trading_state(aid)


@trading.post("/accounts/<int:aid>/close")
def trading_close(aid):
    """Body: {client_order_id, symbol: "source:SYMBOL"}: market order for the whole position."""
    a, j = sim.account(DB, owner(), aid), request.get_json(silent=True) or {}
    key = str(j.get("symbol"))
    sync(a)
    p = sim.position(DB, aid, key)
    if p is None:
        raise ValueError("no open position")
    side, mark = "sell" if p["qty"] > 0 else "buy", fresh_mark(key)
    sim.place_order(DB, owner(), aid, client_id(j), key, side, "market", abs(p["qty"]), mark=mark,
                    now=int(time.time()), fill_at=mark and sim.slipped(mark, side, a["slippage_bps"]))
    return trading_state(aid)


@trading.put("/accounts/<int:aid>/exits")
def trading_exits(aid):
    """Body: {symbol: "source:SYMBOL", sl, tp}; null removes a level."""
    j = request.get_json(silent=True) or {}
    key = str(j.get("symbol"))
    sim.set_exits(DB, owner(), aid, key, fresh_mark(key), j.get("sl"), j.get("tp"), now=int(time.time()))
    return trading_state(aid)


app.register_blueprint(trading)


if __name__ == "__main__":
    # 5050, not 5000: macOS AirPlay Receiver occupies port 5000
    app.run(host=HOST, port=int(os.environ.get("PORT", 5050)), threaded=True)
