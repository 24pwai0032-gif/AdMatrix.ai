"""Synchronous database helpers for Celery workers."""

from __future__ import annotations

import logging
import os
import uuid
from functools import lru_cache

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.orm.attributes import flag_modified

from app.models.schemas import Campaign, CampaignState, RenderTaskStatus, VideoRenderTask

logger = logging.getLogger(__name__)


@lru_cache
def _sync_session_factory() -> sessionmaker[Session]:
    url = os.getenv("DATABASE_URL", "postgresql+asyncpg://admatrix:admatrix@postgres:5432/admatrix")
    sync_url = url.replace("postgresql+asyncpg://", "postgresql://")
    engine = create_engine(sync_url, pool_pre_ping=True)
    return sessionmaker(bind=engine, expire_on_commit=False)


def finalize_render_task(
    campaign_id: str,
    celery_task_id: str | None,
    result: dict | None,
    error: str | None = None,
) -> None:
    """Update render task and campaign state after pipeline completion or failure."""
    session = _sync_session_factory()()
    try:
        cid = uuid.UUID(campaign_id)
        render_task = None
        if celery_task_id:
            stmt = select(VideoRenderTask).where(
                VideoRenderTask.campaign_id == cid,
                VideoRenderTask.celery_task_id == celery_task_id,
            )
            render_task = session.execute(stmt).scalar_one_or_none()
        if not render_task:
            stmt = (
                select(VideoRenderTask)
                .where(VideoRenderTask.campaign_id == cid)
                .order_by(VideoRenderTask.created_at.desc())
            )
            render_task = session.execute(stmt).scalars().first()

        campaign = session.get(Campaign, cid)

        if error or not result or not result.get("final_video_url"):
            if render_task:
                render_task.status = RenderTaskStatus.FAILED
                render_task.error_message = error or result.get("error") if result else error
            if campaign:
                campaign.state = CampaignState.FAILED
        else:
            if render_task:
                render_task.status = RenderTaskStatus.COMPLETED
                render_task.final_video_url = result["final_video_url"]
                render_task.shot_clips = result.get("shot_clips", render_task.shot_clips)
                render_task.audio_track_url = result.get("audio_track_url")
            if campaign:
                campaign.state = CampaignState.RENDERING
                campaign.meta = {**(campaign.meta or {}), "render_complete": True}
                flag_modified(campaign, "meta")

        session.commit()
    except Exception as exc:
        session.rollback()
        logger.exception("Failed to finalize render task: %s", exc)
    finally:
        session.close()
