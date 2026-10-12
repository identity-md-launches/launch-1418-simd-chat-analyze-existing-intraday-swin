import csv
import io
import json
import sqlite3
from pathlib import Path


class Store:
    def __init__(self, path: str):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS posts (asset TEXT, id TEXT, time INTEGER, payload TEXT, PRIMARY KEY(asset, id));
                CREATE TABLE IF NOT EXISTS candles (asset TEXT, time INTEGER, payload TEXT, PRIMARY KEY(asset, time));
                CREATE TABLE IF NOT EXISTS sentiment (asset TEXT, observed_at INTEGER, score REAL, PRIMARY KEY(asset, observed_at));
                CREATE INDEX IF NOT EXISTS sentiment_asof ON sentiment(asset, observed_at);
            """)

    def connect(self):
        return sqlite3.connect(self.path, timeout=10)

    def posts(self, asset: str, after: int, limit: int = 1000) -> list[dict]:
        with self.connect() as db:
            return [json.loads(row[0]) for row in db.execute("SELECT payload FROM posts WHERE asset=? AND time>=? ORDER BY time DESC LIMIT ?", (asset, after, limit))]

    def save_posts(self, asset: str, posts: list[dict], now: int):
        with self.connect() as db:
            db.executemany("INSERT OR REPLACE INTO posts VALUES (?, ?, ?, ?)", [(asset, p["id"], p["time"], json.dumps(p)) for p in posts])
            db.execute("DELETE FROM posts WHERE time < ?", (now - 172800,))

    def save_snapshot(self, snapshot: dict):
        with self.connect() as db:
            # Only closed bars. Never persist a still-forming candle as historical data.
            db.executemany("INSERT OR REPLACE INTO candles VALUES (?, ?, ?)", [(snapshot["asset"], c["time"], json.dumps(c)) for c in snapshot["candles"] if c["time"] + 300 <= snapshot["asOf"]])
            sources = snapshot["sources"]
            if all(s["status"] == "ready" and s["score"] is not None and s["updatedAt"] is not None and 0 <= snapshot["asOf"] - s["updatedAt"] <= 900 for s in sources):
                weights = {"Social": .45, "News": .35, "On-chain": .20}
                score = sum(s["score"] * weights[s["kind"]] for s in sources)
                db.execute("INSERT OR REPLACE INTO sentiment VALUES (?, ?, ?)", (snapshot["asset"], snapshot["asOf"], score))
            oldest = snapshot["asOf"] - 90 * 86400
            db.execute("DELETE FROM candles WHERE time < ?", (oldest,))
            db.execute("DELETE FROM sentiment WHERE observed_at < ?", (oldest,))

    def history(self, asset: str) -> str:
        with self.connect() as db:
            candles = [json.loads(row[0]) for row in db.execute("SELECT payload FROM candles WHERE asset=? ORDER BY time DESC LIMIT 25000", (asset,))][::-1]
            scores = list(db.execute("SELECT observed_at, score FROM sentiment WHERE asset=? ORDER BY observed_at", (asset,)))
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(["time", "open", "high", "low", "close", "volume", "sentiment"])
        cursor, last = 0, None
        for c in candles:
            # A source score may only be used if actually observed before this bar closed.
            close_time = c["time"] + 300
            while cursor < len(scores) and scores[cursor][0] <= close_time:
                last = scores[cursor]
                cursor += 1
            score = last[1] if last and close_time - last[0] <= 900 else ""
            writer.writerow([c[k] for k in ["time", "open", "high", "low", "close", "volume"]] + [score])
        return out.getvalue()
