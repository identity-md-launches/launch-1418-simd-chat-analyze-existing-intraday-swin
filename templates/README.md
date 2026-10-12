# Exchange execution templates

The **Connections** page downloads JSON templates for Kraken (`BTC/USD`), Coinbase (`BTC/USD`), and Binance (`BTC/USDT`). Choose **Manual review** or **Automated template** before downloading. Templates carry your saved signal thresholds, source weights, and risk defaults. They contain environment-variable **names**, never real trading credentials.

`execution.py` is an inspectable integration starting point. It fetches a live Pulse snapshot, checks freshness, source coverage, symbol, signal rules, RSI, quantity, and a configured USD notional cap, then prints a dry-run plan. It **never imports or calls an exchange order endpoint**. Changing `dry_run` to false is rejected, not treated as permission to trade.

## Try a downloaded template

From the repository root, using your downloaded configuration path and running local service:

```sh
python3 templates/execution.py /path/to/pulse-kraken-manual.json \
  --service http://127.0.0.1:8000 \
  --quantity 0.0001
```

Choose your own quantity after reviewing the risk calculator. The example is only a command syntax demonstration, not a trading recommendation. The runner refuses to plan an order above the template's `max_notional_usd`. It reports `submitted: false`, including for buy or sell signals. A hold decision does not imply an order should be placed.

For an automated template, a bounded polling example is:

```sh
python3 templates/execution.py /path/to/pulse-kraken-automated.json \
  --service http://127.0.0.1:8000 \
  --quantity 0.0001 --cycles 3 --interval 30
```

The runner evaluates each closed candle at most once per invocation, then reports skipped duplicate candles. It exits after the requested 1–100 cycles. The test suite exercises three cycles at a 0.01-second interval against a local fixture server; it does not wait for real candle intervals. It is not a resilient always-on trading daemon, and its duplicate tracking is not durable across restarts.

The supplied service's reference price is in USD. The Binance template describes a USDT market. The runner **rejects that quote mismatch** until a reviewed quote-conversion or native-USDT market integration is added; it does not assume a dollar and USDT are identical. Templates are integration options, not claims that accounts are connected.

## Before building real execution

A separate owner-controlled server integration can use CCXT's exchange-specific `create_order` support, following the [CCXT manual](https://github.com/ccxt/ccxt/wiki/manual) and the chosen exchange's current rules. Keep secrets in that server's secret store. The static frontend is not the place to implement signing or store API secrets.

The template runner does not implement balances, quote conversion, exchange precision/minimums, leverage or margin availability, stop/target order placement, market liquidity, order acknowledgement/reconciliation, retries, durable idempotency, or an emergency halt. Risk defaults in the JSON are planning metadata; this runner validates manually supplied quantity against a notional cap and does not use a real account balance. The browser's paper journal is a local record, not a broker order history. These boundaries are intentional because this assignment requests connection templates without real trading keys.
