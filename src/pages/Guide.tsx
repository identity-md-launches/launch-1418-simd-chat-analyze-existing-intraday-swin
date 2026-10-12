import {
  ArrowRight,
  BookOpen,
  ChartNoAxesCombined,
  FlaskConical,
  Plug,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import { Panel } from '../components';

export default function Guide() {
  return (
    <div className="guide-layout">
      <Panel title="Your trading workspace" subtitle="From market context to a considered trade.">
        <div className="padded prose">
          <p>
            Pulse is an intraday and swing research workspace built on the Jev-X foundation. Start in the
            labeled synthetic demo to explore the tools, or connect public market prices without an account or
            API key.
          </p>
          <div className="guide-steps">
            {[
              [
                ChartNoAxesCombined,
                'Read the market',
                'Choose BTC, ETH, SOL, or BNB. View closed candles at 5m, 15m, 1h, or 4h. Adaptive EMA bands show the current volatility envelope. All times use UTC.',
                'overview',
              ],
              [
                SlidersHorizontal,
                'Set your signal',
                'Save sentiment thresholds, an RSI ceiling, and source weights. Enable signal alerts to watch entry, exit, feed and protection changes while this workspace is open.',
                'signals',
              ],
              [
                ShieldCheck,
                'Protect your paper entries',
                'Configure a fixed, ATR or trailing stop. Enter paper equity, then arm maximum drawdown and daily loss limits. Update equity yourself; no exchange account is connected.',
                'risk',
              ],
              [
                FlaskConical,
                'Challenge your strategy',
                'Import historical CSV or explore synthetic history. Compare a baseline with crash, volatility and liquidity scenarios. Calibrate on training data and inspect the separate holdout.',
                'backtest',
              ],
              [
                Plug,
                'Connect live prices',
                'Start the Kraken WebSocket stream with one button. Add the optional service for sentiment evidence. Use pause, reconnect and freshness details to understand the feed.',
                'connections',
              ],
            ].map(([Icon, title, description, route]) => {
              const I = Icon as typeof BookOpen;
              return (
                <div className="guide-step" key={String(route)}>
                  <span className="feed-icon">
                    <I size={20} aria-hidden="true" />
                  </span>
                  <div>
                    <h3>{String(title)}</h3>
                    <p>{String(description)}</p>
                    <a href={`#${route}`} className="text-link">
                      Open {String(title).toLowerCase()}
                      <ArrowRight size={14} aria-hidden="true" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Panel>
      <div className="stack">
        <Panel title="Understand the indicators">
          <div className="padded prose">
            <h3>Volatility adaptation</h3>
            <p>
              Wilder ATR over 14 bars is divided by price and compared with the preceding 50 available ATR
              observations. A ratio below 0.8 is Quiet; above 1.25 is Elevated. The adaptive EMA uses 10–40
              bars and RSI smoothing uses 7–28 bars. Higher relative volatility lengthens smoothing and widens
              bands. This is a deterministic rule, not a prediction.
            </p>
            <h3>Charts and signals</h3>
            <p>
              Chart indicators recalculate at the chosen interval. Saved strategy signals use closed
              five-minute bars. Toggle Adaptive on the chart to compare fixed RSI (14). The strategy has its
              own adaptation setting. VWAP resets at midnight UTC; MACD uses 12/26 EMAs and a 9-bar signal.
            </p>
            <h3>Sentiment and freshness</h3>
            <p>
              Sentiment is a weighted score from 0 to 100, not a probability of profit. Missing or old enabled
              sources hold the signal. A paused, stale or disconnected stream also holds entries. Heartbeats
              confirm the connection; they do not make an old market price fresh.
            </p>
          </div>
        </Panel>
        <Panel title="Risk and alerts">
          <div className="padded prose">
            <p>
              Paper protections start off. Enter your paper equity and arm them to pause new entries at your
              limits. Drawdown compares equity with its recorded peak; daily loss compares with the first
              update of the UTC day. Breaches stay latched until the documented reset. Recheck equity each UTC
              day.
            </p>
            <p>
              Paper journals record planned stops and fills. They do not update equity, reserve balances,
              submit orders or monitor subsequent exits. Backtests separately simulate stops and account
              protection. Gaps and trading costs can exceed planned loss limits.
            </p>
            <p>
              Alerts watch the selected asset and saved strategy. They log transitions, avoid repeated signals
              within your cooldown, and can be acknowledged. Browser storage retains settings and recent
              alerts. There are no background, push, email or desktop notifications.
            </p>
          </div>
        </Panel>
        <Panel title="Optional sentiment setup">
          <div className="padded prose">
            <p>
              The static app connects market prices directly. For social, news and on-chain scores, use the
              included FastAPI, CCXT and SQLite service. Complete commands and the data contract are in the
              repository README and service documentation.
            </p>
            <ol>
              <li>
                Install <code>service/requirements.txt</code> in a Python virtual environment.
              </li>
              <li>Set the frontend origin and provider settings on your server.</li>
              <li>
                Run <code>uvicorn service.main:app</code>.
              </li>
              <li>Enter the service URL in Connections.</li>
            </ol>
            <p>
              Social data needs a TwitterAPI.io key. RSS news needs no key. On-chain scoring needs an
              owner-configured provider. Provider credentials stay on your service. Market data availability
              depends on Kraken, your region and network access.
            </p>
          </div>
        </Panel>
        <div className="callout">
          <p>
            Demo prices, posts and results are synthetic. Calibration and stress scenarios are research tools,
            not evidence of future returns. The workspace is a paper-trading tool and sends no real orders.
          </p>
        </div>
      </div>
    </div>
  );
}
