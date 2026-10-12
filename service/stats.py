"""Jev-X-inspired deterministic preprocessing; see THIRD_PARTY_NOTICES.md."""
import math
import re
from datetime import datetime
from email.utils import parsedate_to_datetime

FEAR_KEYWORDS = {
    "crash", "dump", "liquidation", "sell", "selling", "dead", "bear", "bearish",
    "scam", "rekt", "drop", "loss", "bleeding", "panic", "fear", "down", "dip", "fall",
}
GREED_KEYWORDS = {
    "pump", "moon", "ath", "buy", "buying", "gem", "bull", "bullish", "breakout",
    "rally", "gain", "accumulate", "rocket", "up", "long", "hold", "squeeze",
}


def score_text(text: str) -> float:
    words = set(re.findall(r"[a-z]+", text.lower()))
    fear, greed = len(words & FEAR_KEYWORDS), len(words & GREED_KEYWORDS)
    return round(50 + 50 * (greed - fear) / (greed + fear), 2) if greed + fear else 50.0


def preprocess(posts: list[dict]) -> dict:
    if not posts:
        return {"score": None, "count": 0, "author_diversity_pct": 0, "sample": []}
    authors = {p.get("author", "unknown") for p in posts}
    engaged = sorted(posts, key=lambda p: p.get("likes", 0) + 2 * p.get("retweets", 0), reverse=True)[:25]
    latest = sorted(posts, key=lambda p: p["time"], reverse=True)[:25]
    sample = list({p["id"]: p for p in engaged + latest}.values())
    return {"score": round(sum(score_text(p["text"]) for p in posts) / len(posts), 2), "count": len(posts), "author_diversity_pct": round(len(authors) / len(posts) * 100, 1), "sample": sample}


def parse_time(value: str | int | float | None) -> int | None:
    try:
        if isinstance(value, (int, float)) and math.isfinite(value):
            return int(value)
        if not isinstance(value, str) or not value:
            return None
        dt = datetime.fromisoformat(value.replace("Z", "+00:00")) if re.match(r"^\d{4}-\d{2}-\d{2}T", value) else parsedate_to_datetime(value)
        return int(dt.timestamp()) if dt.tzinfo else None
    except (ValueError, OverflowError, TypeError):
        return None


def valid_url(url: str) -> bool:
    from urllib.parse import urlsplit
    try:
        parsed = urlsplit(url)
        return parsed.scheme in ("https", "http") and bool(parsed.hostname) and not parsed.username and not parsed.password
    except ValueError:
        return False
