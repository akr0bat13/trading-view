# trading-view

Локальный мульти-графиковый дашборд, бесплатный аналог платных функций TradingView:
до 8 графиков на экране, неограниченное число индикаторов, Volume Profile и Fair Value Gap.

- Графики: [Lightweight Charts](https://github.com/tradingview/lightweight-charts) v5 (лежит в `static/vendor`, интернет для неё не нужен)
- Крипта: Hyperliquid — история через REST, live-свечи через публичный websocket (без ключей)
- Акции США и Индии (NSE/BSE): yfinance через маленький Flask-бэкенд, обновление каждые 15 с
- Фронтенд: чистые HTML/CSS/JS, без фреймворков и сборки

## Запуск

Нужен Python 3.10+. Одна команда (macOS/Linux):

```bash
./run.sh
```

Скрипт при первом запуске создаст `.venv`, поставит зависимости и откроет http://127.0.0.1:5050.
Другой порт: `PORT=8000 ./run.sh`. Порт 5000 не используется, потому что на macOS его занимает AirPlay Receiver.

Вручную (и на Windows):

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

## Что умеет

- **Number of charts** — 1, 2, 4, 6, 8 (1 = весь экран, 2 = рядом, 4 = 2×2, 6 = 3×2, 8 = 4×2). Выбор и настройки каждого графика сохраняются после перезагрузки.
- В каждом графике свой рынок (Crypto / US / India), символ (можно вписать любой, есть подсказки) и таймфрейм: 1m, 5m, 15m, 30m, 1h, 1d, 1w, 1M.
  - Индия: `RELIANCE` → `RELIANCE.NS`; для BSE пишите `RELIANCE.BO`, индекс Nifty — `^NSEI`.
  - Крипта: тикеры Hyperliquid (`BTC`, `ETH`, `SOL`, `HYPE`, `kPEPE`…).
- Тикер-бар над графиком: цена, изменение к закрытию прошлого дня, вспышка зелёным/красным на каждое изменение цены.
- Индикаторы, без лимита: Volume, Bollinger Bands, VWAP, RSI, MACD, Williams %R, **Volume Profile** (POC/VAH/VAL, по видимой области) и **Fair Value Gap** (зелёные — бычьи, красные — медвежьи; закрытые гэпы бледнее).
- Бейджи статуса: HL live, US market open/closed, India market open/closed (по расписанию торгов, без учёта праздников).

## Как подключить другого брокера

Весь доступ к данным — в `data_source.py`. Добавьте одну функцию `fetch(symbol, tf)`, которая
возвращает список свечей `{"time", "open", "high", "low", "close", "volume"}`, и зарегистрируйте её в `SOURCES` —
новый рынок появится в выпадающем списке каждого графика. Пример для Binance есть в начале файла.
Alpaca, Zerodha, Polygon и т.п. подключаются так же (их API-ключи — уже ваша забота).

## Тесты

```bash
node tests/indicators.test.js
```

## Ограничения

- Yahoo отдаёт 1m-данные только за последние ~7 дней, 5m–30m за 60 дней; котировки бывают с задержкой ~15 мин для некоторых бирж.
- Live для акций — опрос раз в 15 с, а не стрим (yfinance не даёт стрима).
- Время на оси — локальное время браузера.
