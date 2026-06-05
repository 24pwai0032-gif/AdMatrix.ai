"""Product ingest endpoints."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.middleware.telemetry import ModelProvider, TokenUsageTracker, UsageRecord
from app.models.schemas import CompanyProduct, CompanyProductCreate, CompanyProductRead
from app.services.assets import slim_image_assets
from app.services.scraper import ProductIngestService
from app.utils.security import SSRFError

router = APIRouter(prefix="/api/v1", tags=["ingest"])
logger = logging.getLogger(__name__)
settings = get_settings()


@router.post("/ingest", response_model=CompanyProductRead)
async def ingest_product(body: CompanyProductCreate, db: AsyncSession = Depends(get_db)):
    if settings.demo_mode:
        return _demo_product(str(body.source_url))

    scraper = ProductIngestService(
        qwen_api_key=settings.qwen_api_key,
        qwen_base_url=settings.qwen_base_url,
    )
    try:
        data = await scraper.ingest_product(str(body.source_url))
    except SSRFError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Ingest failed for %s", body.source_url)
        raise HTTPException(status_code=502, detail="Product ingest failed") from exc

    product = CompanyProduct(
        source_url=str(body.source_url),
        company_name=data.get("company_name"),
        product_name=data.get("product_name"),
        raw_html=None,  # omit raw HTML from DB in production
        cleaned_text=data.get("cleaned_text"),
        image_assets=slim_image_assets(data.get("image_assets")),
        brand_book=data.get("brand_book"),
    )
    db.add(product)
    await db.commit()
    await db.refresh(product)

    tracker = TokenUsageTracker(db)
    await tracker.log_usage(
        None,
        UsageRecord(model="qwen3.6-plus", provider=ModelProvider.QWEN, input_tokens=2000, output_tokens=500),
    )
    await db.commit()
    return product


def _demo_product(url: str) -> CompanyProductRead:
    now = datetime.now(timezone.utc)
    return CompanyProductRead(
        id=uuid.uuid4(),
        source_url=url,
        company_name="Demo Brand Co.",
        product_name="Smart Hydration Bottle",
        image_assets={"images": []},
        brand_book={
            "brand_voice": "innovative, eco-conscious",
            "color_palette": ["#0f3460", "#e94560", "#ffffff"],
            "key_selling_points": ["24h cold", "BPA-free", "smart tracking"],
        },
        metadata={"demo": True},
        created_at=now,
        updated_at=now,
    )
