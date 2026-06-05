"""Financial guardrails and token usage monitoring."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import DateTime, Float, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import select

from app.config import get_settings
from app.models.schemas import Base, Campaign

logger = logging.getLogger(__name__)


class ModelProvider(str, Enum):
    QWEN = "qwen"
    WAN27 = "wan2.7"
    HAPPYHORSE = "happyhorse"


# Per-model cost rates (USD per 1K tokens or per second for video)
MODEL_COST_RATES: dict[str, dict[str, float]] = {
    "qwen3.6-plus": {"input_per_1k": 0.002, "output_per_1k": 0.006},
    "qwen-tts": {"per_second": 0.0001},
    "wan2.7": {"per_second": 0.05},
    "happyhorse": {"per_second": 0.04},
}


class TokenUsageLog(Base):
    __tablename__ = "token_usage_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True)
    model: Mapped[str] = mapped_column(String(64), nullable=False)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    duration_sec: Mapped[float | None] = mapped_column(Float)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    meta: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class UsageRecord(BaseModel):
    model: str
    provider: ModelProvider
    input_tokens: int = 0
    output_tokens: int = 0
    duration_sec: float | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class TokenUsageTracker:
    """Track per-model costs and enforce pre-render budget gates."""

    def __init__(self, db: AsyncSession):
        self.db = db

    def calculate_cost(self, record: UsageRecord) -> float:
        rates = MODEL_COST_RATES.get(record.model, {})
        cost = 0.0

        if "input_per_1k" in rates:
            cost += (record.input_tokens / 1000) * rates["input_per_1k"]
        if "output_per_1k" in rates:
            cost += (record.output_tokens / 1000) * rates["output_per_1k"]
        if "per_second" in rates and record.duration_sec:
            cost += record.duration_sec * rates["per_second"]

        return round(cost, 6)

    async def log_usage(
        self,
        campaign_id: uuid.UUID | None,
        record: UsageRecord,
    ) -> TokenUsageLog:
        cost = self.calculate_cost(record)
        entry = TokenUsageLog(
            campaign_id=campaign_id,
            model=record.model,
            provider=record.provider.value,
            input_tokens=record.input_tokens,
            output_tokens=record.output_tokens,
            duration_sec=record.duration_sec,
            cost_usd=cost,
            meta=record.metadata,
        )
        self.db.add(entry)
        await self.db.flush()
        return entry

    async def get_campaign_spend(self, campaign_id: uuid.UUID) -> float:
        result = await self.db.execute(
            select(func.coalesce(func.sum(TokenUsageLog.cost_usd), 0.0)).where(
                TokenUsageLog.campaign_id == campaign_id
            )
        )
        return float(result.scalar_one())

    async def check_budget_gate(
        self,
        campaign_id: uuid.UUID,
        estimated_additional_cost: float = 0.0,
    ) -> dict[str, Any]:
        """Pre-render budget gate — block if spend would exceed threshold."""
        settings = get_settings()
        campaign = await self.db.get(Campaign, campaign_id)
        budget = campaign.budget_usd if campaign else settings.budget_threshold_usd
        current_spend = await self.get_campaign_spend(campaign_id)
        projected = current_spend + estimated_additional_cost

        allowed = projected <= budget
        return {
            "allowed": allowed,
            "current_spend_usd": round(current_spend, 4),
            "projected_spend_usd": round(projected, 4),
            "budget_usd": budget,
            "threshold_usd": get_settings().budget_threshold_usd,
        }

    async def get_live_metrics(self, campaign_id: uuid.UUID | None = None) -> dict[str, Any]:
        """Aggregate metrics for dashboard widget."""
        query = select(TokenUsageLog)
        if campaign_id:
            query = query.where(TokenUsageLog.campaign_id == campaign_id)

        result = await self.db.execute(query)
        logs = result.scalars().all()

        by_model: dict[str, dict[str, Any]] = {}
        total_cost = 0.0
        total_input = 0
        total_output = 0

        for log in logs:
            total_cost += log.cost_usd
            total_input += log.input_tokens
            total_output += log.output_tokens

            if log.model not in by_model:
                by_model[log.model] = {"cost_usd": 0.0, "calls": 0, "provider": log.provider}
            by_model[log.model]["cost_usd"] += log.cost_usd
            by_model[log.model]["calls"] += 1

        return {
            "campaign_id": str(campaign_id) if campaign_id else None,
            "total_cost_usd": round(total_cost, 4),
            "total_input_tokens": total_input,
            "total_output_tokens": total_output,
            "by_model": by_model,
            "budget_threshold_usd": get_settings().budget_threshold_usd,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
