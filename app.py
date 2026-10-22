import hmac
import json
import os
import re
import threading
from pathlib import Path

import requests
from flask import Flask, Response, jsonify, request

import data_source

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


if __name__ == "__main__":
    # 5050, not 5000: macOS AirPlay Receiver occupies port 5000
    app.run(host=HOST, port=int(os.environ.get("PORT", 5050)), threaded=True)
