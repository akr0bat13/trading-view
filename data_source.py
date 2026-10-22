"""Pluggable market data sources.

Every source is ONE function: fetch(symbol, tf) -> list of candles
    [{"time": unix_seconds, "open": f, "high": f, "low": f, "close": f, "volume": f}, ...]
where tf is one of TIMEFRAMES. Register it in SOURCES and it shows up in every
pane's market dropdown. The browser polls it for live updates; crypto from
Hyperliquid additionally streams over Hyperliquid's public websocket.

Example — add Binance:

    def binance(symbol, tf):
        r = requests.get("https://api.binance.com/api/v3/klines",
                         params={"symbol": symbol, "interval": tf, "limit": 500}, timeout=10)
        return [{"time": k[0] // 1000, "open": float(k[1]), "high": float(k[2]),
                 "low": float(k[3]), "close": float(k[4]), "volume": float(k[5])}
                for k in r.json()]

    SOURCES["binance"] = {"label": "Binance", "fetch": binance, "symbols": ["BTCUSDT", "ETHUSDT"]}
"""
import time

import requests
import yfinance as yf

TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "1d", "1w", "1M"]
TF_SECONDS = {"1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600,
              "1d": 86400, "1w": 604800, "1M": 2592000}

HL_INFO = "https://api.hyperliquid.xyz/info"


def hyperliquid(symbol, tf):
    end = int(time.time() * 1000)
    start = max(0, end - TF_SECONDS[tf] * 1000 * 1000)  # ~1000 bars back (HL caps at 5000)
    r = requests.post(HL_INFO, json={"type": "candleSnapshot", "req": {
        "coin": symbol.upper(), "interval": tf, "startTime": start, "endTime": end}}, timeout=10)
    r.raise_for_status()
    return [{"time": c["t"] // 1000, "open": float(c["o"]), "high": float(c["h"]),
             "low": float(c["l"]), "close": float(c["c"]), "volume": float(c["v"])}
            for c in r.json()]


# yfinance interval name + longest period Yahoo allows for it
YF_TF = {"1m": ("1m", "5d"), "5m": ("5m", "30d"), "15m": ("15m", "60d"), "30m": ("30m", "60d"),
         "1h": ("1h", "180d"), "1d": ("1d", "5y"), "1w": ("1wk", "10y"), "1M": ("1mo", "max")}


def yahoo(symbol, tf):
    interval, period = YF_TF[tf]
    df = yf.Ticker(symbol).history(period=period, interval=interval, auto_adjust=False)
    df = df.dropna(subset=["Open", "High", "Low", "Close"])
    return [{"time": int(ts.timestamp()), "open": float(r.Open), "high": float(r.High),
             "low": float(r.Low), "close": float(r.Close), "volume": float(r.Volume)}
            for ts, r in df.iterrows()]


def yahoo_india(symbol, tf):
    # "RELIANCE" -> NSE ticker "RELIANCE.NS"; explicit ".BO" (BSE) / ".NS" kept as is
    symbol = symbol.upper()
    return yahoo(symbol if "." in symbol or symbol.startswith("^") else symbol + ".NS", tf)


SOURCES = {
    "crypto": {"label": "Crypto (Hyperliquid)", "fetch": hyperliquid, "live": "hyperliquid",
               "symbols": ["BTC", "ETH", "SOL", "HYPE", "XRP", "DOGE", "BNB", "AVAX", "LINK", "SUI"]},
    "us": {"label": "US stocks", "fetch": yahoo,
           "symbols": ["AAPL", "TSLA", "NVDA", "MSFT", "AMZN", "META", "GOOGL", "AMD", "SPY", "QQQ"]},
    "india": {"label": "India (NSE/BSE)", "fetch": yahoo_india,
              "symbols": ["RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "SBIN", "ITC",
                          "TATAMOTORS", "BHARTIARTL", "^NSEI"]},
}


def get_candles(source, symbol, tf):
    if source not in SOURCES:
        raise ValueError(f"unknown source {source!r}")
    if tf not in TIMEFRAMES:
        raise ValueError(f"unknown timeframe {tf!r}")
    return SOURCES[source]["fetch"](symbol, tf)
