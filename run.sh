#!/usr/bin/env bash
# One command to start locally: creates .venv on first run, installs deps, opens the browser.
set -e
cd "$(dirname "$0")"
PORT="${PORT:-5050}"
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q -r requirements.txt
(sleep 2; open "http://127.0.0.1:$PORT" 2>/dev/null || xdg-open "http://127.0.0.1:$PORT") >/dev/null 2>&1 &
PORT="$PORT" exec .venv/bin/python app.py
