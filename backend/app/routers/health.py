"""Health check endpoints."""

from __future__ import annotations

import redis.asyncio as aioredis
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.database import check_db_connection

router = APIRouter(tags=["health"])
settings = get_settings()


@router.get("/health")
async def health():
    db_ok = await check_db_connection()
    redis_ok = False
    try:
        client = aioredis.from_url(settings.redis_url, socket_connect_timeout=2)
        redis_ok = await client.ping()
        await client.aclose()
    except Exception:
        redis_ok = False

    body = {
        "status": "ok" if db_ok and redis_ok else "degraded",
        "service": "admatrix-api",
        "version": "1.0.0",
        "environment": settings.environment,
        "demo_mode": settings.demo_mode,
        "checks": {"database": db_ok, "redis": redis_ok},
    }
    if not db_ok:
        return JSONResponse(status_code=503, content=body)
    return body
