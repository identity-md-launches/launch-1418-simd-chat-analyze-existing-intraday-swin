import asyncio
import csv
import io
import os
import tempfile
import time
import unittest
import json
import subprocess
import sys
import threading
import httpx
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

from fastapi.testclient import TestClient

from service import main, providers
from service.stats import parse_time, preprocess, score_text
from service.store import Store
from templates.execution import plan


def fixture_snapshot():
    now = int(time.time())
    closed = now // 300 * 300 - 300
    candles = [{"time": closed - (39-i)*300, "open": 100, "high": 101, "low": 99, "close": 100, "volume": 10, "sentiment": None} for i in range(40)]
    sources = [{"kind": k, "score": 75, "count": 10, "updatedAt": now, "status": "ready", "detail": "Test fixture"} for k in ["Social", "News", "On-chain"]]
    return {"asset": "BTC", "mode": "live", "asOf": now, "price": 100, "change": 0, "volume": 1000, "candles": candles, "sources": sources, "feed": []}


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="pulse-service-test-")
        self.database = os.path.join(self.directory.name, "market.sqlite3")
        self.store = Store(self.database)

    def tearDown(self):
        self.directory.cleanup()

    def test_keyword_polarity_and_stratified_dedup(self):
        self.assertEqual(score_text("Bullish, breakout!"), 100)
        self.assertEqual(score_text("Panic and crash."), 0)
        self.assertEqual(score_text("An update on Bitcoin"), 50)
        posts = [{"id": str(i), "text": "bullish", "author": str(i % 10), "time": i, "likes": i} for i in range(70)]
        stats = preprocess(posts)
        self.assertEqual(stats["score"], 100)
        self.assertEqual(stats["count"], 70)
        self.assertEqual(stats["author_diversity_pct"], 14.3)
        self.assertEqual(len({p["id"] for p in stats["sample"]}), len(stats["sample"]))

    def test_timestamps_never_replace_unknown_date_with_now(self):
        self.assertIsNone(parse_time("invalid"))
        self.assertIsNone(parse_time("2026-01-01T00:00:00"))
        self.assertEqual(parse_time("2026-01-01T00:00:00Z"), 1767225600)
        self.assertEqual(parse_time("Thu, 01 Jan 2026 00:00:00 +0000"), 1767225600)

    def test_posts_are_deduplicated_persisted_and_asset_scoped(self):
        now = int(time.time())
        post = {"id": "unit-test-post", "time": now, "text": "unit test"}
        self.store.save_posts("BTC", [post, post], now)
        self.assertEqual(len(self.store.posts("BTC", now-10)), 1)
        self.assertEqual(self.store.posts("ETH", now-10), [])
        self.assertEqual(Store(self.database).posts("BTC", now-10)[0]["id"], post["id"])

    def test_history_never_applies_new_scores_to_older_candles(self):
        snapshot = fixture_snapshot()
        first = snapshot["candles"][0]["time"]
        with self.store.connect() as db:
            db.execute("INSERT INTO sentiment VALUES (?, ?, ?)", ("BTC", first+450, 70))
        self.store.save_snapshot(snapshot)
        rows = list(csv.DictReader(io.StringIO(self.store.history("BTC"))))
        self.assertEqual(rows[0]["sentiment"], "")
        self.assertEqual(rows[1]["sentiment"], "70.0")
        self.assertEqual(rows[-1]["sentiment"], "")

    def test_incomplete_sources_do_not_create_historical_score(self):
        snapshot = fixture_snapshot()
        snapshot["sources"][0]["score"] = None
        snapshot["sources"][0]["status"] = "unavailable"
        self.store.save_snapshot(snapshot)
        with self.store.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM sentiment").fetchone()[0], 0)

    def test_missing_sources_are_explicitly_unavailable(self):
        with patch.dict(os.environ, {}, clear=True):
            for fn in [providers.social, providers.onchain]:
                source, feed = asyncio.run(fn("BTC", self.store))
                self.assertEqual(source["status"], "unavailable")
                self.assertIsNone(source["score"])
                self.assertEqual(feed, [])

    def test_onchain_contract_accepts_real_shape_and_rejects_stale_or_unattributed_data(self):
        now = int(time.time())
        payload = {"asset": "BTC", "score": 72, "count": 40, "observedAt": now, "provider": "Local test fixture", "methodology": "Synthetic values for contract validation only"}
        client_class = httpx.AsyncClient
        def client_factory(**kwargs):
            return client_class(**kwargs, transport=httpx.MockTransport(lambda request: httpx.Response(200, json=payload)))
        with patch.dict(os.environ, {"PULSE_ONCHAIN_URL": "http://127.0.0.1/onchain"}), patch.object(providers.httpx, "AsyncClient", client_factory):
            self.assertEqual(asyncio.run(providers.onchain("BTC", self.store))[0]["status"], "ready")
            payload["observedAt"] = now - 901
            self.assertEqual(asyncio.run(providers.onchain("BTC", self.store))[0]["status"], "unavailable")
            payload["observedAt"] = now
            payload["provider"] = ""
            self.assertEqual(asyncio.run(providers.onchain("BTC", self.store))[0]["status"], "unavailable")

    def test_provider_failures_do_not_expose_raw_exception(self):
        async def fails(*args):
            raise ValueError("private provider diagnostic")
        source, _ = asyncio.run(providers.safe_source("News", fails, "BTC", self.store))
        self.assertNotIn("private", source["detail"])
        self.assertEqual(source["status"], "unavailable")

    def test_api_contract_cache_cors_and_no_trading_endpoint(self):
        data = fixture_snapshot()
        calls = []
        async def market(asset):
            calls.append(asset)
            return {k: data[k] for k in ["price", "change", "volume", "candles"]}
        async def source(kind, fn, asset, store):
            return next(s for s in data["sources"] if s["kind"] == kind), []
        main.cache.clear()
        with patch.dict(os.environ, {"PULSE_DB": self.database}), patch.object(providers, "market", market), patch.object(providers, "safe_source", source), TestClient(main.app) as client:
            health = client.get("/api/health")
            self.assertEqual(health.status_code, 200)
            self.assertFalse(health.json()["trading"])
            response = client.get("/api/snapshot?asset=BTC", headers={"Origin": "http://localhost:5173"})
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["access-control-allow-origin"], "http://localhost:5173")
            self.assertEqual(response.json()["mode"], "live")
            self.assertEqual(len(response.json()["sources"]), 3)
            self.assertEqual(client.get("/api/snapshot?asset=BTC").status_code, 200)
            self.assertEqual(calls, ["BTC"])
            self.assertEqual(client.get("/api/snapshot?asset=UNSUPPORTED").status_code, 422)
            self.assertEqual(client.post("/api/order", json={}).status_code, 404)
            self.assertTrue(client.get("/api/history?asset=BTC").text.startswith("time,open,high,low,close,volume,sentiment"))
        main.cache.clear()

    def test_market_failure_returns_503_without_fake_prices(self):
        async def fails(asset):
            raise ValueError("private upstream text")
        async def source(kind, fn, asset, store):
            return providers.unavailable(kind, "not configured")
        main.cache.clear()
        with patch.dict(os.environ, {"PULSE_DB": self.database}), patch.object(providers, "market", fails), patch.object(providers, "safe_source", source), TestClient(main.app) as client:
            response = client.get("/api/snapshot?asset=BTC")
            self.assertEqual(response.status_code, 503)
            self.assertNotIn("private", response.text)
            self.assertNotIn("price", response.json())

    def test_execution_template_rejects_live_mode_stale_data_and_quote_mismatch(self):
        config = {"exchange": "kraken", "dry_run": True, "symbol": "BTC/USD", "signal": {"buy_above": 65, "sell_below": 35, "rsi_ceiling": 75}, "execution": {"max_notional_usd": 100}}
        data = fixture_snapshot()
        result = plan(config, data, .5)
        self.assertEqual(result["side"], "buy")
        self.assertFalse(result["submitted"])
        with self.assertRaisesRegex(ValueError, "dry_run"):
            plan({**config, "dry_run": False}, data, .5)
        with self.assertRaisesRegex(ValueError, "USD market"):
            plan({**config, "symbol": "BTC/USDT"}, data, .5)
        with self.assertRaisesRegex(ValueError, "fresh live"):
            plan(config, {**data, "asOf": data["asOf"]-121}, .5)
        with self.assertRaisesRegex(ValueError, "exceeds"):
            plan(config, data, 2)

    def test_execution_honors_custom_weights_and_disabled_sources(self):
        config = {"exchange": "kraken", "dry_run": True, "symbol": "BTC/USD", "signal": {"buy_above": 65, "sell_below": 35, "rsi_ceiling": 75, "weights": {"Social": 0, "News": 100, "On-chain": 0}}, "execution": {"max_notional_usd": 100}}
        data = fixture_snapshot()
        data["sources"][0]["score"] = None
        data["sources"][0]["status"] = "unavailable"
        self.assertEqual(plan(config, data, .5)["side"], "buy")
        data["sources"][1]["score"] = 20
        self.assertEqual(plan(config, data, .5)["side"], "sell")

    def test_automated_runner_uses_short_interval_and_skips_duplicate_candles(self):
        snapshot = fixture_snapshot()
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps(snapshot).encode())
            def log_message(self, *args):
                pass
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        config = {"exchange": "kraken", "mode": "automated", "dry_run": True, "symbol": "BTC/USD", "signal": {"buy_above": 65, "sell_below": 35, "rsi_ceiling": 75}, "execution": {"max_notional_usd": 100}}
        filename = os.path.join(self.directory.name, "execution-config.json")
        with open(filename, "w") as f:
            json.dump(config, f)
        try:
            completed = subprocess.run([sys.executable, "templates/execution.py", filename, "--service", f"http://127.0.0.1:{server.server_port}", "--quantity", "0.5", "--cycles", "3", "--interval", "0.01"], capture_output=True, text=True, timeout=10, check=True)
            lines = [json.loads(line) for line in completed.stdout.splitlines()]
            self.assertEqual(len(lines), 3)
            self.assertEqual(lines[0]["side"], "buy")
            self.assertTrue(all(line["submitted"] is False for line in lines))
            self.assertEqual(lines[1]["reason"], "Closed candle already evaluated")
            self.assertEqual(lines[2]["reason"], "Closed candle already evaluated")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
