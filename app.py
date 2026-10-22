import json
import os
import re
import threading
from pathlib import Path

from flask import Flask, jsonify, request

import data_source

app = Flask(__name__, static_folder="static", static_url_path="")
app.json.sort_keys = False  # keep SOURCES order in the market dropdown


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
        return jsonify(data_source.get_candles(a["source"], a["symbol"].strip(), a.get("tf", "15m")))
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


# UI state (settings, drawings, layouts, ...) lives in local JSON files under state/,
# so it survives browser changes and localhost vs 127.0.0.1.
STATE = Path(__file__).with_name("state")
STATE_LOCK = threading.Lock()
NAME = re.compile(r"^[a-z]{1,32}$")

STATE.mkdir(exist_ok=True)
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
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5050)), threaded=True)
