# Live integration methods

Implementation: [src/lib/live.ts](../src/lib/live.ts), [src/App.tsx](../src/App.tsx), [src/lib/validation.ts](../src/lib/validation.ts), [src/lib/engine.ts](../src/lib/engine.ts) and [Connections](../src/pages/Connections.tsx).

## Two independent data paths

Selecting **Connect market stream** opens `wss://ws.kraken.com/v2`. One connection handles the selected asset's USD ticker and five-minute candles. BTC, ETH, SOL and BNB are selectable; an unavailable listing or rejected subscription is displayed as an error. No account endpoints or authentication are used.

The optional owner-hosted sentiment service remains a separate HTTP path. Its snapshots provide source scores, observation times and activity. `mergeMarketSnapshot` copies only `sources` and `feed` from a same-asset snapshot whose mode is `live`; it preserves the market stream's prices and candle history. Stream candles have `sentiment: null`. Demo source scores are never merged into live prices.

The service is polled every 30 seconds while the live page is visible and no request is running. Pausing the WebSocket does not pause this independent polling. An aborted or replaced request cannot overwrite a newer asset/request. Service credentials stay on the server; [service/README.md](../service/README.md) describes owner-set provider configuration and endpoint contracts. In this frontend the action is named **Connect sentiment service**.

## Subscription and history

The client sends these messages on socket open, with `BTC/USD` replaced by the selected pair:

```json
{"method":"subscribe","params":{"channel":"ticker","symbol":["BTC/USD"],"snapshot":true,"event_trigger":"trades"},"req_id":1}
{"method":"subscribe","params":{"channel":"ohlc","symbol":["BTC/USD"],"snapshot":true,"interval":5},"req_id":2}
```

The trade-triggered ticker and OHLC channels follow Kraken's [ticker contract](https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/ticker) and [OHLC contract](https://docs.kraken.com/exchange/api-reference/spot-websocket-v2/ohlc), checked during the documentation repair. The app converts base volume to an estimated USD volume using `volume × vwap`; it displays `change_pct` and the last trade price.

In parallel, REST requests `https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=5` for BTC (`ETHUSD`, `SOLUSD` or `BNBUSD` otherwise), with a 12-second abort deadline. Kraken's [REST OHLC documentation](https://docs.kraken.com/api-reference/market-data/get-ohlc-data) describes bounded recent history and the unfinished final interval. The parser validates every returned row, discards intervals whose end is after local now, and retains at most 720 closed candles. Actual returned closed counts can be lower; this is not a full historical archive.

Stream observations received while REST is pending take precedence over the older REST response. A timestamp-keyed map and cumulative trade/volume versions prevent regression within an interval. At most 721 bars are retained internally to allow an open interval; only the latest 720 closed bars are published. There is no interpolation of missing intervals.

## Validation before state publication

| Input | Enforced checks |
| --- | --- |
| Envelope | String payload no larger than 1,000,000 characters; parseable JSON object; supported channel/type; no more than 1,000 data items |
| Ticker | Exact selected symbol; positive finite price/VWAP, finite change/volume and product; nonnegative volume; parseable timestamp, no regression, no more than 60 seconds ahead or 60 seconds old |
| Candle | Exact selected symbol; five-minute interval; aligned positive timestamp; positive finite OHLC, valid high/low geometry, nonnegative volume; finite nonnegative integral trade count |
| Candle update order | Cumulative trades and volume must not decrease for a previously observed interval; `interval_begin` is treated as a candle boundary, not an event sequence timestamp |
| REST history | One result series plus `last`; expected row shape; validated numbers and geometry; strictly increasing times; at least one closed bar |
| Service snapshot | Matching asset and live provenance; recent snapshot/closed-history times, 30–25,000 bars, valid OHLC order, exactly the three known source kinds, safe HTTP(S) activity links and finite bounded scores |

Malformed socket observations increase `dropped`; they cannot replace the displayed market. Equal ticker timestamps are accepted in arrival order on that socket. A failed subscription stops automatic retries and explains recovery. Failure to hydrate history is visible independently of whether current prices stream successfully.

## Lifecycle, publication and recovery

Normal data publications are coalesced on a 250 ms timer (at most four scheduled UI publications per second). Pausing, connection errors and stale-state transitions publish immediately. The stream continues to process incoming messages between publications; batching reduces React updates without claiming every exchange tick is rendered.

Every connection has a generation number. Cleanup increments it, cancels timers, aborts history loading, detaches handlers and closes the old socket. Callbacks check generation before mutation. Asset switches, return to demo and component unmount dispose of the former client. Pause preserves an explicitly frozen snapshot. Resume/manual reconnect starts a new connection and retry budget.

| Timer / condition | Behavior |
| --- | --- |
| 15-second subscription deadline | Retry if a usable ticker/subscription never arrives |
| Two-second watchdog | Check transport silence, market age and ping schedule |
| 15 seconds since last ping | Send application `ping` with request ID 3 |
| More than 25 seconds without an accepted transport message | Reconnect with backoff |
| More than 60 seconds since the exchange ticker timestamp | Mark Stale and hold signals, even if heartbeats still arrive |
| Retry delay | `min(30,000 ms, 1,000 ms × 2^(attempt−1)) × (0.8 + random × 0.4)`; thus the jittered maximum can reach 36 seconds |
| Eight automatic retries exhausted | Stop and require explicit Reconnect |
| More than 30 seconds in a live connection | Reset the retry counter |
| Tab visible / browser online | Recover a stale stream through the same retry mechanism; do not bypass the retry budget |

## Decisions and freshness

The application requires a `live` stream state to enable live decisions; connecting, reconnecting, stale, paused and error states hold them. `evaluate` also checks a live snapshot's age (120-second outer validation boundary) and the last five-minute bar: it must be closed and its opening time no more than 900 seconds old. The stream's 60-second ticker rule is the stricter normal market boundary. The UI refreshes freshness evaluation periodically; paper submission checks current time and the 60-second price age again at the moment of saving.

`sourceFreshness` requires ready status, a score and an observation timestamp. Observations can be at most 900 seconds behind the market snapshot time and at most 60 seconds ahead. Aggregation and the Sentiment/Connections badges use this same predicate. A weight of zero deliberately disables a source; every enabled source must be fresh for a decision. New price messages never restamp source observations.

## Diagnostics, tests and operational limits

Connections reports stream state, retry count, invalid observations, history readiness and message delay. Delay is local receipt time minus the exchange timestamp, including clock skew; it is neither network RTT nor an execution latency promise.

`tests/live.test.ts` injects socket, fetch, timer, clock and randomness to exercise validation, batching, reconnect races, pause, stale heartbeats, retry limits and incomplete history without real waiting. Browser fixtures exercise the actual controls and held decisions. A separate real-network walkthrough exercises public Kraken, recorded in [live-browser-report.json](live-browser-report.json); results are observations of one run, not an uptime guarantee. See [validation](validation.md).

No credentialed sentiment integrations were exercised in this repair. Region/firewall restrictions, CORS, exchange changes, tab suspension and local clock errors can affect live operation. Only the selected asset streams; inactive cards are not a multi-market live subscription. No persistent tick recorder, sequence-number replay, automatic provider failover, full order book, background service worker or exchange execution is implemented. API failures remain explicit and never silently substitute synthetic data labeled as live.
