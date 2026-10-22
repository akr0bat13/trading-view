import os

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


if __name__ == "__main__":
    # 5050, not 5000: macOS AirPlay Receiver occupies port 5000
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5050)), threaded=True)
