import json
import os
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


# Chart drawings live in one local JSON file: {"crypto:BTC": [drawing, ...], ...}
DRAWINGS = Path(__file__).with_name("drawings.json")
DRAWINGS_LOCK = threading.Lock()


@app.get("/api/drawings")
def get_drawings():
    return jsonify(json.loads(DRAWINGS.read_text()) if DRAWINGS.exists() else {})


@app.put("/api/drawings/<path:key>")
def put_drawings(key):
    items = request.get_json(silent=True)
    if not isinstance(items, list):
        return jsonify(error="expected a JSON list"), 400
    with DRAWINGS_LOCK:
        all_ = json.loads(DRAWINGS.read_text()) if DRAWINGS.exists() else {}
        if items:
            all_[key] = items
        else:
            all_.pop(key, None)
        tmp = DRAWINGS.with_suffix(".tmp")
        tmp.write_text(json.dumps(all_, indent=1))
        tmp.replace(DRAWINGS)  # atomic: a crash mid-write never leaves a half-written file
    return jsonify(ok=True)


if __name__ == "__main__":
    # 5050, not 5000: macOS AirPlay Receiver occupies port 5000
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5050)), threaded=True)
