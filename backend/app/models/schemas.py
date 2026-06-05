"""SQLAlchemy 2.0 ORM models and Pydantic v2 API schemas for AdMatrix.ai."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, HttpUrl
from sqlalchemy import DateTime, Enum, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class CampaignState(str, enum.Enum):
    """10-state campaign lifecycle state machine."""

    DRAFT = "draft"
    INGESTING = "ingesting"
    SCRIPTING = "scripting"
    AWAITING_APPROVAL = "awaiting_approval"
    APPROVED = "approved"
    RENDERING = "rendering"
    COMPLIANCE_CHECK = "compliance_check"
    FAILED = "failed"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class RenderTaskStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


# ---------------------------------------------------------------------------
# SQLAlchemy ORM
# ---------------------------------------------------------------------------


class CompanyProduct(Base):
    __tablename__ = "company_products"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_url: Mapped[str] = mapped_column(String(2048), nullable=False, index=True)
    company_name: Mapped[str | None] = mapped_column(String(512))
    product_name: Mapped[str | None] = mapped_column(String(512))
    raw_html: Mapped[str | None] = mapped_column(Text)
    cleaned_text: Mapped[str | None] = mapped_column(Text)
    image_assets: Mapped[dict[str, Any] | None] = mapped_column(JSONB, default=dict)
    brand_book: Mapped[dict[str, Any] | None] = mapped_column(JSONB, default=dict)
    meta: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    campaigns: Mapped[list["Campaign"]] = relationship(back_populates="product", cascade="all, delete-orphan")


class Campaign(Base):
    __tablename__ = "campaigns"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    product_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("company_products.id", ondelete="CASCADE"), nullable=False
    )
    state: Mapped[CampaignState] = mapped_column(
        Enum(CampaignState, name="campaign_state"), default=CampaignState.DRAFT, index=True
    )
    target_locales: Mapped[list[str]] = mapped_column(JSONB, default=list)
    primary_locale: Mapped[str] = mapped_column(String(16), default="en-US")
    script_draft: Mapped[dict[str, Any] | None] = mapped_column(JSONB, default=dict)
    transcreated_scripts: Mapped[dict[str, Any] | None] = mapped_column(JSONB, default=dict)
    revision_count: Mapped[int] = mapped_column(Integer, default=0)
    approval_notes: Mapped[str | None] = mapped_column(Text)
    compliance_report: Mapped[dict[str, Any] | None] = mapped_column(JSONB, default=dict)
    budget_usd: Mapped[float] = mapped_column(Float, default=10.0, nullable=False)
    meta: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    product: Mapped["CompanyProduct"] = relationship(back_populates="campaigns")
    storyboards: Mapped[list["VideoStoryboard"]] = relationship(
        back_populates="campaign", cascade="all, delete-orphan"
    )
    render_tasks: Mapped[list["VideoRenderTask"]] = relationship(
        back_populates="campaign", cascade="all, delete-orphan"
    )


class VideoStoryboard(Base):
    __tablename__ = "video_storyboards"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    locale: Mapped[str] = mapped_column(String(16), default="en-US")
    scenes: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    narrative: Mapped[str | None] = mapped_column(Text)
    panel_images: Mapped[list[str]] = mapped_column(JSONB, default=list)
    hitl_status: Mapped[str] = mapped_column(String(32), default="pending")
    meta: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    campaign: Mapped["Campaign"] = relationship(back_populates="storyboards")


class VideoRenderTask(Base):
    __tablename__ = "video_render_tasks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    storyboard_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("video_storyboards.id", ondelete="SET NULL")
    )
    locale: Mapped[str] = mapped_column(String(16), default="en-US")
    status: Mapped[RenderTaskStatus] = mapped_column(
        Enum(RenderTaskStatus, name="render_task_status"), default=RenderTaskStatus.PENDING
    )
    celery_task_id: Mapped[str | None] = mapped_column(String(128))
    audio_track_url: Mapped[str | None] = mapped_column(String(2048))
    shot_clips: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    final_video_url: Mapped[str | None] = mapped_column(String(2048))
    error_message: Mapped[str | None] = mapped_column(Text)
    meta: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    campaign: Mapped["Campaign"] = relationship(back_populates="render_tasks")


# ---------------------------------------------------------------------------
# Pydantic v2 API schemas
# ---------------------------------------------------------------------------


class TimestampMixin(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    created_at: datetime
    updated_at: datetime


class CompanyProductCreate(BaseModel):
    source_url: HttpUrl


class CompanyProductRead(TimestampMixin):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: uuid.UUID
    source_url: str
    company_name: str | None = None
    product_name: str | None = None
    image_assets: dict[str, Any] = Field(default_factory=dict)
    brand_book: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict, validation_alias="meta")


class CampaignCreate(BaseModel):
    product_id: uuid.UUID
    target_locales: list[str] = Field(default_factory=lambda: ["en-US"], min_length=1)
    primary_locale: str = Field(default="en-US", min_length=2, max_length=16)
    budget_usd: float = Field(default=10.0, gt=0, le=1000.0)


class CampaignRead(TimestampMixin):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: uuid.UUID
    product_id: uuid.UUID
    state: CampaignState
    target_locales: list[str]
    primary_locale: str
    script_draft: dict[str, Any] = Field(default_factory=dict)
    transcreated_scripts: dict[str, Any] = Field(default_factory=dict)
    revision_count: int
    approval_notes: str | None = None
    compliance_report: dict[str, Any] = Field(default_factory=dict)
    budget_usd: float | None = None
    metadata: dict[str, Any] = Field(default_factory=dict, validation_alias="meta")


class StoryboardScene(BaseModel):
    scene_id: str
    order: int
    narration: str
    visual_prompt: str
    duration_sec: float = 3.0
    panel_image_url: str | None = None
    audio_segment_url: str | None = None
    video_clip_url: str | None = None


class VideoStoryboardRead(TimestampMixin):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    campaign_id: uuid.UUID
    locale: str
    scenes: list[dict[str, Any]] = Field(default_factory=list)
    narrative: str | None = None
    panel_images: list[str] = Field(default_factory=list)
    hitl_status: str


class ScenePatchRequest(BaseModel):
    narration: str | None = Field(default=None, max_length=2000)
    visual_prompt: str | None = Field(default=None, max_length=4000)
    duration_sec: float | None = Field(default=None, gt=0.5, le=30.0)
    panel_image_url: str | None = Field(default=None, max_length=2048)


class ApprovalRequest(BaseModel):
    action: str = Field(pattern="^(APPROVE|REJECT)$")
    notes: str | None = None


class VideoRenderTaskRead(TimestampMixin):
    id: uuid.UUID
    campaign_id: uuid.UUID
    storyboard_id: uuid.UUID | None = None
    locale: str
    status: RenderTaskStatus
    audio_track_url: str | None = None
    shot_clips: list[dict[str, Any]] = Field(default_factory=list)
    final_video_url: str | None = None
    error_message: str | None = None


class VideoUrlResponse(BaseModel):
    campaign_id: uuid.UUID
    video_url: str
    expires_in_seconds: int | None = None


class TelemetryLogRequest(BaseModel):
    campaign_id: uuid.UUID
    model: str = Field(max_length=64)
    provider: str  # validated in router via ModelProvider
    input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)
    duration_sec: float | None = Field(default=None, ge=0)
    metadata: dict[str, Any] = Field(default_factory=dict)
