"""A bounded manual/automated dry-run template; no real orders are ever submitted."""
import argparse
import json
import math
import time
import urllib.request
from urllib.parse import urlsplit


def plan(config: dict, snapshot: dict, quantity: float) -> dict:
    if config.get("exchange") not in {"kraken", "binance", "coinbase"}:
        raise ValueError("Choose kraken, binance, or coinbase.")
    if config.get("dry_run") is not True:
        raise ValueError("This template only permits dry_run=true. It never submits live orders.")
    if not math.isfinite(quantity) or quantity <= 0:
        raise ValueError("Quantity must be positive.")
    if snapshot.get("mode") != "live" or not 0 <= time.time() - snapshot["asOf"] <= 120:
        raise ValueError("A fresh live snapshot is required.")
    if snapshot["asset"] != config["symbol"].split("/")[0]:
        raise ValueError("Snapshot asset does not match the exchange symbol.")
    # A quote conversion is mandatory: the data service supplies USD, not USDT.
    if not config["symbol"].endswith("/USD"):
        raise ValueError("This runner requires a USD market. Implement and validate quote-currency conversion for USDT first.")
    sources = snapshot["sources"]
    kinds = {"Social", "News", "On-chain"}
    rules = config["signal"]
    weights = rules.get("weights", {"Social": 45, "News": 35, "On-chain": 20})
    if set(weights) != kinds or any(not isinstance(v, (int, float)) or not math.isfinite(v) or not 0 <= v <= 100 for v in weights.values()) or sum(weights.values()) <= 0:
        raise ValueError("Provide positive source weights with a nonzero total.")
    if len(sources) != 3 or {s["kind"] for s in sources} != kinds or any(s["status"] != "ready" or s["score"] is None or not math.isfinite(s["score"]) or not 0 <= s["score"] <= 100 or s["updatedAt"] is None or not 0 <= time.time() - s["updatedAt"] <= 900 for s in sources if weights[s["kind"]] > 0):
        raise ValueError("Every enabled source must have a fresh, valid score.")
    score = round(sum(s["score"] * weights[s["kind"]] for s in sources if weights[s["kind"]] > 0) / sum(weights.values()))
    if not 0 <= rules["sell_below"] < rules["buy_above"] <= 100 or not 1 <= rules["rsi_ceiling"] <= 100:
        raise ValueError("Invalid signal thresholds.")
    prices = [c["close"] for c in snapshot["candles"]]
    if len(prices) < 30:
        raise ValueError("At least 30 closed price bars are required.")
    if not 300 <= time.time() - snapshot["candles"][-1]["time"] <= 900:
        raise ValueError("The latest closed candle must be fresh.")
    gains = [max(0, b - a) for a, b in zip(prices, prices[1:])]
    losses = [max(0, a - b) for a, b in zip(prices, prices[1:])]
    gain, loss = sum(gains[:14]) / 14, sum(losses[:14]) / 14
    for g, l in zip(gains[14:], losses[14:]):
        gain, loss = (gain * 13 + g) / 14, (loss * 13 + l) / 14
    rsi = 50 if not gain and not loss else 100 if not loss else 100 - 100 / (1 + gain / loss)
    side = "sell" if score <= rules["sell_below"] else "buy" if score >= rules["buy_above"] and rsi <= rules["rsi_ceiling"] else "hold"
    price = snapshot["price"]
    cap = config["execution"]["max_notional_usd"]
    if not math.isfinite(price) or price <= 0 or not math.isfinite(cap) or cap <= 0 or quantity * price > cap:
        raise ValueError("Invalid price, or order exceeds max_notional_usd.")
    return {"dry_run": True, "exchange": config["exchange"], "symbol": config["symbol"], "side": side, "quantity": quantity, "limit_price": price, "notional_usd": quantity * price, "sentiment": round(score, 2), "rsi": round(rsi, 2), "bar_time": snapshot["candles"][-1]["time"], "submitted": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", help="JSON template downloaded from Pulse Connections")
    parser.add_argument("--service", required=True, help="Your running Pulse service URL")
    parser.add_argument("--quantity", type=float, required=True)
    parser.add_argument("--cycles", type=int, default=1, help="Bounded automated samples, 1–100")
    parser.add_argument("--interval", type=float, default=30, help="Seconds between samples, 0.01–3600")
    args = parser.parse_args()
    if not 1 <= args.cycles <= 100 or not .01 <= args.interval <= 3600:
        parser.error("Use 1–100 cycles and an interval of 0.01–3600 seconds.")
    parsed = urlsplit(args.service)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        parser.error("Use an HTTP(S) service URL without credentials, query, or fragment.")
    with open(args.config) as f:
        config = json.load(f)
    if config.get("mode") not in {"manual", "automated"}:
        parser.error("Configuration mode must be manual or automated.")
    if config["mode"] == "manual" and args.cycles != 1:
        parser.error("Manual review uses one cycle.")
    asset = config["symbol"].split("/")[0]
    last_bar = None
    for i in range(args.cycles):
        with urllib.request.urlopen(f"{args.service.rstrip('/')}/api/snapshot?asset={asset}", timeout=20) as response:
            snapshot = json.load(response)
        result = plan(config, snapshot, args.quantity)
        if result["bar_time"] != last_bar:
            print(json.dumps(result))
            last_bar = result["bar_time"]
        else:
            print(json.dumps({"dry_run": True, "submitted": False, "reason": "Closed candle already evaluated"}))
        if i < args.cycles - 1:
            time.sleep(args.interval)


if __name__ == "__main__":
    main()
