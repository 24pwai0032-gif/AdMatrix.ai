"""Production startup validation."""

from __future__ import annotations

import logging
import os

from app.config import get_settings

logger = logging.getLogger(__name__)


def validate_production_config() -> None:
    settings = get_settings()
    warnings: list[str] = []

    if not settings.demo_mode and not settings.api_key:
        warnings.append("API_KEY is not set — all endpoints are publicly accessible")

    if not settings.demo_mode and not settings.qwen_api_key:
        warnings.append("QWEN_API_KEY is not set — AI features will use deterministic fallbacks")

    if settings.database_url.startswith("postgresql") and "admatrix:admatrix" in settings.database_url:
        if os.getenv("ENVIRONMENT", "").lower() == "production":
            warnings.append("DATABASE_URL uses default credentials — rotate before production")

    signing_secret = settings.api_key or settings.video_signing_secret
    if not settings.demo_mode and not signing_secret:
        warnings.append("VIDEO_SIGNING_SECRET/API_KEY not set — video URLs cannot be signed")

    for msg in warnings:
        logger.warning("CONFIG: %s", msg)
