"""Read-only live market and sentiment aggregation. Never submits exchange orders."""
import asyncio
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse

from . import providers
from .store import Store

Asset = Literal["BTC", "ETH", "SOL", "BNB"]
store: Store | None = None
cache: dict[str, dict] = {}
locks = {asset: asyncio.Lock() for asset in providers.ASSETS}


@asynccontextmanager
async def lifespan(app: FastAPI):
    global store
    # User-owned runtime state stays outside the source tree by default.
    store = Store(os.getenv("PULSE_DB", str(Path.home() / ".local/share/pulse/market.sqlite3")))
    yield


app = FastAPI(title="Pulse data service", version="1.0.0", lifespan=lifespan)
origins = [o.strip() for o in os.getenv("PULSE_ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:4173,http://127.0.0.1:5173,http://127.0.0.1:4173").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=False, allow_methods=["GET"], allow_headers=["Accept", "Content-Type"])


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": "1.0.0", "trading": False, "sources": {"social_configured": bool(os.getenv("TWITTER_API_KEY")), "onchain_configured": bool(os.getenv("PULSE_ONCHAIN_URL")), "jev_configured": bool(os.getenv("TYPESAFE_API_KEY"))}}


@app.get("/api/snapshot")
async def snapshot(asset: Asset = Query(default="BTC")):
    assert store is not None
    async with locks[asset]:
        current = cache.get(asset)
        if current and time.time() - current["asOf"] < 25:
            return current
        market_task = asyncio.create_task(providers.market(asset))
        source_task = asyncio.gather(
            providers.safe_source("Social", providers.social, asset, store),
            providers.safe_source("News", providers.news, asset, store),
            providers.safe_source("On-chain", providers.onchain, asset, store),
        )
        try:
            market, sources = await asyncio.wait_for(asyncio.gather(market_task, source_task), timeout=18)
        except Exception:
            market_task.cancel()
            source_task.cancel()
            await asyncio.gather(market_task, source_task, return_exceptions=True)
            raise HTTPException(status_code=503, detail="Live market data unavailable. Check service connectivity or exchange support.") from None
        result = {"asset": asset, "mode": "live", "asOf": int(time.time()), **market, "sources": [s[0] for s in sources], "feed": sorted([item for source in sources for item in source[1]], key=lambda item: item["time"], reverse=True)[:100]}
        store.save_snapshot(result)
        cache[asset] = result
        return result


@app.get("/api/history", response_class=PlainTextResponse)
async def history(asset: Asset = Query(default="BTC")):
    assert store is not None
    return PlainTextResponse(store.history(asset), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="pulse-{asset.lower()}-history.csv"'})
