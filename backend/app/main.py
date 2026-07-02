"""FastAPI gateway entry point for AdMatrix.ai."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.database import init_db
from app.logging_config import setup_logging
from app.middleware.auth import verify_api_key
from app.middleware.request_id import RequestIdMiddleware
from app.middleware.security_headers import SecurityHeadersMiddleware
from app.routers import campaigns, health, ingest, metrics, videos
from app.startup import validate_production_config
from app.state_machine import InvalidStateTransition

setup_logging()
logger = logging.getLogger(__name__)
settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    validate_production_config()
    if not settings.demo_mode:
        await init_db()
    logger.info(
        "AdMatrix.ai API started env=%s demo_mode=%s",
        settings.environment,
        settings.demo_mode,
    )
    yield
    logger.info("AdMatrix.ai API shutting down")


app = FastAPI(
    title="AdMatrix.ai API",
    version="1.0.0",
    description="AI-powered multilingual video ad production platform",
    lifespan=lifespan,
)

app.include_router(health.router)
app.include_router(videos.router)
app.include_router(ingest.router, dependencies=[Depends(verify_api_key)])
app.include_router(campaigns.router, dependencies=[Depends(verify_api_key)])
app.include_router(metrics.router, dependencies=[Depends(verify_api_key)])

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RequestIdMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    response = await call_next(request)
    if request.url.path != "/health":
        rid = getattr(request.state, "request_id", "-")
        logger.info("%s %s %s -> %s", rid, request.method, request.url.path, response.status_code)
    return response


@app.exception_handler(InvalidStateTransition)
async def invalid_state_handler(_request: Request, exc: InvalidStateTransition):
    return JSONResponse(
        status_code=409,
        content={
            "detail": {
                "message": str(exc),
                "current_state": exc.current.value,
                "allowed_states": [s.value for s in exc.allowed],
            }
        },
    )
