"""Pluggable market data sources.

Every source is ONE function: fetch(symbol, tf, before=None) -> list of candles
    [{"time": unix_seconds, "open": f, "high": f, "low": f, "close": f, "volume": f}, ...]
where tf is one of TIMEFRAMES. With before=<unix seconds> return the page of history that ends
just before that time (the chart asks for it when you scroll left); return [] when there is no more. Register it in SOURCES and it shows up in the symbol
search and the watchlist. The browser polls it for live updates; crypto from
Hyperliquid additionally streams over Hyperliquid's public websocket.

Optional: "quotes": fn(symbols) -> {symbol: {"price": f, "prev": previous close}} for the
watchlist. Without it, the watchlist uses the last two daily candles from fetch().

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
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor

import requests
import yfinance as yf

TIMEFRAMES = ["1m", "5m", "15m", "30m", "1h", "1d", "1w", "1M"]
TF_SECONDS = {"1m": 60, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600,
              "1d": 86400, "1w": 604800, "1M": 2592000}

HL_INFO = "https://api.hyperliquid.xyz/info"


def hyperliquid(symbol, tf, before=None):
    end = int(before * 1000) - 1 if before else int(time.time() * 1000)
    start = max(0, end - TF_SECONDS[tf] * 1000 * 1000)  # ~1000 bars back (HL caps at 5000)
    r = requests.post(HL_INFO, json={"type": "candleSnapshot", "req": {
        "coin": symbol.upper(), "interval": tf, "startTime": start, "endTime": end}}, timeout=10)
    r.raise_for_status()
    return [{"time": c["t"] // 1000, "open": float(c["o"]), "high": float(c["h"]),
             "low": float(c["l"]), "close": float(c["c"]), "volume": float(c["v"])}
            for c in r.json()]


def hyperliquid_quotes(symbols):
    meta, ctxs = requests.post(HL_INFO, json={"type": "metaAndAssetCtxs"}, timeout=10).json()
    by_name = {u["name"]: c for u, c in zip(meta["universe"], ctxs)}
    return {s: {"price": float(by_name[s]["markPx"]), "prev": float(by_name[s]["prevDayPx"])}
            for s in symbols if s in by_name}


# yfinance interval name + longest period Yahoo allows for it
YF_TF = {"1m": ("1m", "5d"), "5m": ("5m", "30d"), "15m": ("15m", "60d"), "30m": ("30m", "60d"),
         "1h": ("1h", "180d"), "1d": ("1d", "5y"), "1w": ("1wk", "10y"), "1M": ("1mo", "max")}


def yahoo(symbol, tf, before=None):
    interval, period = YF_TF[tf]
    if before:  # older page; Yahoo refuses intraday data past its window, which just means "no more"
        end = datetime.fromtimestamp(before, timezone.utc)
        try:
            df = yf.Ticker(symbol).history(start=end - timedelta(seconds=TF_SECONDS[tf] * 500), end=end, interval=interval, auto_adjust=False)
        except Exception:
            return []
    else:
        df = yf.Ticker(symbol).history(period=period, interval=interval, auto_adjust=False)
    df = df.dropna(subset=["Open", "High", "Low", "Close"])
    return [{"time": int(ts.timestamp()), "open": float(r.Open), "high": float(r.High),
             "low": float(r.Low), "close": float(r.Close), "volume": float(r.Volume)}
            for ts, r in df.iterrows()]


def yahoo_quotes(symbols, ticker=lambda s: s):
    def one(s):
        close = yf.Ticker(ticker(s)).history(period="5d", interval="1d")["Close"].dropna()
        return {"price": float(close.iloc[-1]), "prev": float(close.iloc[-2]) if len(close) > 1 else None}
    return _parallel(one, symbols)


def _parallel(fn, symbols):
    def safe(s):
        try:
            return fn(s)
        except Exception:
            return None  # one bad symbol must not blank the whole watchlist
    with ThreadPoolExecutor(8) as ex:
        return {s: q for s, q in zip(symbols, ex.map(safe, symbols)) if q}


# --- Moscow Exchange (MOEX ISS, free, no key) ---
ISS = "https://iss.moex.com/iss"
MSK = timezone(timedelta(hours=3))
# tf -> (ISS interval, resample to N minutes or 1, lookback days). ISS has 1/10/60/24/7/31 only,
# so 5m and 15m are built from 1-minute bars (short history), 30m from 10-minute bars.
MOEX_TF = {"1m": (1, 1, 3), "5m": (1, 5, 4), "15m": (1, 15, 4), "30m": (10, 30, 20),
           "1h": (60, 1, 200), "1d": (24, 1, 1500), "1w": (7, 1, 3650), "1M": (31, 1, 3650)}
MOEX_INDEXES = {"IMOEX", "RTSI", "MOEXBC", "MOEXOG", "MOEXFN"}


def moex(symbol, tf, before=None):
    symbol = symbol.upper()
    interval, minutes, days = MOEX_TF[tf]
    till = datetime.fromtimestamp(before, MSK) - timedelta(seconds=1) if before else datetime.now(MSK)
    market = "index" if symbol in MOEX_INDEXES else "shares"
    url = f"{ISS}/engines/stock/markets/{market}/securities/{symbol}/candles.json"
    rows, start = [], 0
    while start < 6000:  # ISS pages are 500 rows
        r = requests.get(url, params={"interval": interval, "start": start,
                                      "from": (till - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S"),
                                      "till": till.strftime("%Y-%m-%d %H:%M:%S")}, timeout=15)
        r.raise_for_status()
        block = r.json()["candles"]
        cols = block["columns"]
        page = [dict(zip(cols, row)) for row in block["data"]]
        rows += page
        if len(page) < 500:
            break
        start += 500
    out = []
    for c in rows:
        t = int(datetime.strptime(c["begin"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=MSK).timestamp())
        if minutes > 1:
            t -= t % (minutes * 60)
        if out and out[-1]["time"] == t:  # same resampled bucket
            o = out[-1]
            o["high"], o["low"] = max(o["high"], c["high"]), min(o["low"], c["low"])
            o["close"], o["volume"] = c["close"], o["volume"] + c["volume"]
        else:
            out.append({"time": t, "open": c["open"], "high": c["high"], "low": c["low"], "close": c["close"], "volume": c["volume"]})
    return out


def moex_quotes(symbols):
    r = requests.get(f"{ISS}/engines/stock/markets/shares/boards/TQBR/securities.json", timeout=15, params={
        "iss.only": "securities,marketdata", "securities.columns": "SECID,PREVPRICE", "marketdata.columns": "SECID,LAST"})
    r.raise_for_status()
    j = r.json()
    prev = dict(j["securities"]["data"])
    last = dict(j["marketdata"]["data"])
    return {s: {"price": float(last.get(s) or prev[s]), "prev": float(prev[s])} for s in symbols if s in prev and (last.get(s) or prev[s])}


SOURCES = {
    "crypto": {"label": "Crypto (Hyperliquid)", "fetch": hyperliquid, "quotes": hyperliquid_quotes, "live": "hyperliquid",
               "symbols": ["BTC", "ETH", "SOL", "HYPE", "XRP", "DOGE", "BNB", "AVAX", "LINK", "SUI"]},
    "us": {"label": "US stocks", "fetch": yahoo, "quotes": yahoo_quotes,
           "symbols": ["AAPL", "TSLA", "NVDA", "MSFT", "AMZN", "META", "GOOGL", "AMD", "SPY", "QQQ"]},
    "ru": {"label": "Russia (MOEX)", "fetch": moex, "quotes": moex_quotes,
           "symbols": ["SBER", "GAZP", "LKOH", "YDEX", "ROSN", "GMKN", "NVTK", "TATN", "MOEX", "VTBR", "IMOEX"]},
    "asia": {"label": "Asia (Tokyo, HK, China, Korea)", "fetch": yahoo, "quotes": yahoo_quotes,
             "symbols": ["^N225", "7203.T", "6758.T", "9984.T", "^HSI", "0700.HK", "9988.HK", "000001.SS", "600519.SS", "005930.KS"]},
    "eu": {"label": "Europe (Xetra, LSE, Paris, Amsterdam)", "fetch": yahoo, "quotes": yahoo_quotes,
           "symbols": ["^GDAXI", "^FTSE", "^STOXX50E", "SAP.DE", "SIE.DE", "ASML.AS", "MC.PA", "AZN.L", "SHEL.L", "NESN.SW"]},
}


def get_candles(source, symbol, tf, before=None):
    if source not in SOURCES:
        raise ValueError(f"unknown source {source!r}")
    if tf not in TIMEFRAMES:
        raise ValueError(f"unknown timeframe {tf!r}")
    return SOURCES[source]["fetch"](symbol, tf, before)


def get_quotes(source, symbols):
    src = SOURCES[source]
    if "quotes" in src:
        return src["quotes"](symbols)

    def from_candles(s):
        c = src["fetch"](s, "1d")
        return {"price": c[-1]["close"], "prev": c[-2]["close"] if len(c) > 1 else None}
    return _parallel(from_candles, symbols)
