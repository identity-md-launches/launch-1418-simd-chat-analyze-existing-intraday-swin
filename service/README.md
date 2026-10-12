# Optional live data service

The static site works without this service. This service is for an owner-operated personal workspace. It exposes read-only research endpoints and has no trade-submission route.

## Install and run

Use Python 3.12 or later. From the repository root:

```sh
python3 -m venv /tmp/pulse-venv
/tmp/pulse-venv/bin/python -m pip install -r service/requirements.lock.txt
PULSE_DB=/tmp/pulse-data/market.sqlite3 /tmp/pulse-venv/bin/python -m uvicorn service.main:app --host 127.0.0.1 --port 8000
```

On Debian/Ubuntu, install your distribution's `python3-venv` package if the virtual-environment command reports that `ensurepip` is missing. `requirements.lock.txt` records the exact Python dependencies used for validation; `requirements.txt` lists the direct dependency pins. Production owners should use a persistent, backed-up location for `PULSE_DB`; the temporary path above is for trying the service locally. With no `PULSE_DB` setting, the default is `~/.local/share/pulse/market.sqlite3`.

Open the site, choose **Connections**, enter `http://127.0.0.1:8000`, then select **Connect service**. Public Kraken prices and news RSS are available without credentials when upstream services are reachable. Social and on-chain sources remain explicitly unavailable until configured. Set their weights to zero if you deliberately want a signal based only on the configured sources.

The service binds to loopback in this example. For remote use, supply HTTPS, the exact permitted frontend origin, and your own access/quota controls. CORS is not authentication. The personal service should not be exposed as an unrestricted public paid-API proxy. The browser rejects credentials embedded in the service URL and incompatible mixed-content remote URLs.

## Server settings

Set these through your shell, process manager, or hosting platform's secret configuration. No secret files or credentials are included in this repository.

| Variable | Purpose | Default |
| --- | --- | --- |
| `PULSE_ALLOWED_ORIGINS` | Comma-separated exact frontend origins, including scheme and port | localhost / 127.0.0.1 on ports 5173 and 4173 |
| `PULSE_DB` | SQLite runtime database path | `~/.local/share/pulse/market.sqlite3` |
| `TWITTER_API_KEY` | Your TwitterAPI.io credential, server-only | Absent; social unavailable |
| `PULSE_SOCIAL_SAMPLE` | Requested social sample size, clamped to 50–1,000 | `100` |
| `TYPESAFE_API_KEY` | Optional TypeSafe model credential, server-only | Absent; keyword polarity |
| `PULSE_ONCHAIN_URL` | Owner's on-chain score endpoint, HTTP(S), without credentials in the URL | Absent; on-chain unavailable |
| `PULSE_ONCHAIN_TOKEN` | Optional bearer token sent to the on-chain provider only | Absent |

Costs and quotas depend on your provider accounts. Fetching a larger social sample can require multiple paid requests. Page ingestion stops after encountering a stored post, uses at most 35 pages, and respects a 16-second source deadline. Repeated snapshots use a 25-second cache with one in-flight request per asset. The browser requests a new snapshot at most once every 30 seconds during normal automatic refresh; manual refresh also respects the service cache.

## Provider behavior

**Market data:** CCXT's Kraken adapter retrieves a spot ticker and up to 720 five-minute OHLCV bars. Only closed candles are returned and stored. Some symbols or regions may be unsupported; a market failure returns HTTP 503, without synthetic fallback prices. Volume is the exchange's quote volume, or an estimate from candle close × base volume when quote volume is missing. The UI does not separately label that volume fallback.

**Social:** the TwitterAPI.io latest search endpoint searches the asset symbol and name in English, excluding retweets. Timestamped posts from the last 24 hours are stored by `(asset, post ID)` and deduplicated. Scores average per-post keyword polarity: 0 bearish, 50 neutral/no recognized terms, 100 bullish. Author diversity is distinct authors / sample count. Up to 25 high-engagement and 25 recent unique posts form the optional Jev sample. This adapts Jev-X's preprocessing and early-stop ingestion approach. If optional TypeSafe inference fails, the source detail explicitly identifies the keyword fallback; no invented confidence is returned.

**News:** the two RSS feeds are parsed using `defusedxml`. Only matching asset headlines published within 24 hours are scored. Headline links and publisher names are preserved. The source reports how many feeds were reachable. RSS availability and publisher coverage are not guaranteed.

**On-chain:** the owner supplies a real provider or small adapter that converts its chain observations into a directional score. Pulse does not infer that arbitrary transaction activity is bullish or bearish. The provider must disclose its calculation and observation window in plain English. For example, if you choose exchange net flows, your adapter is responsible for address attribution, units, coverage, normalization, and the directional assumption; Pulse does not supply or guess that dataset.

The configured endpoint receives `GET <PULSE_ONCHAIN_URL>?asset=BTC` (or ETH, SOL, BNB) and must return a JSON object matching [onchain.schema.json](onchain.schema.json):

| Field | Required value |
| --- | --- |
| `asset` | Exact requested asset symbol |
| `score` | Real number from 0 to 100, based on actual provider data |
| `count` | Positive integer count of underlying observations |
| `observedAt` | Unix seconds at measurement; no more than 900 seconds old, not in the future |
| `provider` | Your actual source name |
| `methodology` | Plain-English calculation, observation window, and limitations |

No fabricated provider ID, wallet address, API key, endpoint, or chain observation is included. Missing configuration uses an explicit unavailable state. The optional bearer token remains on the service. Response content is limited to 2 MB and source errors do not disclose raw upstream responses or credentials.

## API

- `GET /api/health` — service version, trading disabled, and booleans indicating source configuration. Never returns credentials.
- `GET /api/snapshot?asset=BTC` — `asset`, `mode: "live"`, `asOf`, `price`, `change`, `volume`, `candles`, `sources`, and `feed`. Each source includes `kind`, nullable `score`, count, nullable `updatedAt`, status, and methodology/detail. Unsupported symbols return 422. Market failure returns 503. Source failure returns a partial snapshot with that source marked unavailable.
- `GET /api/history?asset=BTC` — historical CSV with `time,open,high,low,close,volume,sentiment`.
- `/docs` — generated FastAPI endpoint documentation.

For social and news, `updatedAt` is the successful sample evaluation time; individual posts/headlines retain their publication time. A recent evaluation may contain older material from the documented 24-hour lookback. On-chain freshness uses the provider's actual `observedAt`. The frontend validates timestamps, finite values, OHLC consistency, source identities, safe link protocols, and the latest closed candle before accepting a response.

History records only observed complete three-source scores with default 45/35/20 weights. A score is attached only to a candle that closed after the score was measured, and only if no more than 15 minutes old. Earlier candles have blank sentiment; scores are never backfilled into the past. Browser-custom weights do not retroactively alter stored history. Collect data by leaving the connected browser tab open, or polling `/api/snapshot` from an owner-operated collector. There is no background collector when the app is closed. Raw social posts are retained for two days; candle and score history for 90 days; CSV export is capped at 25,000 candles.

## Check

```sh
/tmp/pulse-venv/bin/python -m unittest discover -s tests -p 'test_*.py' -v
```

Tests use temporary SQLite databases, explicit provider fixtures, and a bounded local HTTP server. No real exchange or provider keys are used. The recorded live smoke check in `artifacts/service-live-smoke.json` verifies public BTC data and RSS availability in the worker environment; it does not certify provider uptime or the owner's future configuration.
