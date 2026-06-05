"""Telemetry and metrics endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.telemetry import ModelProvider, TokenUsageTracker, UsageRecord
from app.models.schemas import TelemetryLogRequest

router = APIRouter(prefix="/api/v1", tags=["metrics"])


@router.get("/metrics")
async def get_metrics(
    campaign_id: uuid.UUID | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    tracker = TokenUsageTracker(db)
    return await tracker.get_live_metrics(campaign_id)


@router.post("/telemetry/log")
async def log_telemetry(body: TelemetryLogRequest, db: AsyncSession = Depends(get_db)):
    tracker = TokenUsageTracker(db)
    try:
        provider = ModelProvider(body.provider)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid provider: {body.provider}") from exc

    entry = await tracker.log_usage(
        body.campaign_id,
        UsageRecord(
            model=body.model,
            provider=provider,
            input_tokens=body.input_tokens,
            output_tokens=body.output_tokens,
            duration_sec=body.duration_sec,
            metadata=body.metadata,
        ),
    )
    await db.commit()
    return {"id": str(entry.id), "cost_usd": entry.cost_usd}
