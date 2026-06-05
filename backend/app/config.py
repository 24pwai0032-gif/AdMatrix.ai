"""Centralized application settings."""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = Field(
        default="postgresql+asyncpg://admatrix:admatrix@postgres:5432/admatrix",
        alias="DATABASE_URL",
    )
    redis_url: str = Field(default="redis://localhost:6379/0", alias="REDIS_URL")
    qwen_api_key: str | None = Field(default=None, alias="QWEN_API_KEY")
    qwen_base_url: str = Field(
        default="https://dashscope.aliyuncs.com/compatible-mode/v1",
        alias="QWEN_BASE_URL",
    )
    cors_origins: str = Field(default="http://localhost:3000", alias="CORS_ORIGINS")
    demo_mode: bool = Field(default=False, alias="DEMO_MODE")
    api_key: str | None = Field(default=None, alias="API_KEY")
    video_output_dir: str = Field(default="/tmp/admatrix/videos", alias="VIDEO_OUTPUT_DIR")
    security_log_path: str = Field(
        default="/tmp/admatrix/security_trace.log",
        alias="SECURITY_LOG_PATH",
    )
    budget_threshold_usd: float = Field(default=10.0, alias="BUDGET_THRESHOLD_USD")
    max_scrape_bytes: int = Field(default=5_000_000, alias="MAX_SCRAPE_BYTES")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    environment: str = Field(default="development", alias="ENVIRONMENT")
    video_signing_secret: str | None = Field(default=None, alias="VIDEO_SIGNING_SECRET")
    video_url_ttl_seconds: int = Field(default=3600, alias="VIDEO_URL_TTL_SECONDS")
    celery_task_time_limit: int = Field(default=600, alias="CELERY_TASK_TIME_LIMIT")
    max_revisions: int = Field(default=5, alias="MAX_REVISIONS")

    @property
    def signing_secret(self) -> str | None:
        return self.video_signing_secret or self.api_key

    @field_validator("demo_mode", mode="before")
    @classmethod
    def parse_bool(cls, v: object) -> bool:
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            return v.lower() in ("1", "true", "yes")
        return bool(v)

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
