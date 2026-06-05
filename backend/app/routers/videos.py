"""Video file serving with signed URL support."""

from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, Security
from fastapi.responses import FileResponse
from fastapi.security import APIKeyHeader
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models.schemas import RenderTaskStatus, VideoRenderTask
from app.utils.signing import SignatureError, verify_resource_signature

router = APIRouter(prefix="/api/v1/videos", tags=["videos"])
settings = get_settings()
_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def _authorize_video_access(
    campaign_id: uuid.UUID,
    exp: int | None,
    sig: str | None,
    api_key: str | None,
) -> None:
    if settings.signing_secret:
        if exp is None or sig is None:
            raise HTTPException(status_code=401, detail="Signed URL required (exp & sig)")
        try:
            verify_resource_signature(campaign_id, exp, sig, settings.signing_secret)
        except SignatureError as exc:
            raise HTTPException(status_code=401, detail=str(exc)) from exc
        return
    if settings.api_key:
        if not api_key or api_key != settings.api_key:
            raise HTTPException(status_code=401, detail="Invalid or missing API key")


@router.get("/{campaign_id}")
async def serve_video(
    campaign_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    exp: int | None = Query(None),
    sig: str | None = Query(None),
    api_key: str | None = Security(_api_key_header),
):
    await _authorize_video_access(campaign_id, exp, sig, api_key)

    result = await db.execute(
        select(VideoRenderTask)
        .where(VideoRenderTask.campaign_id == campaign_id)
        .order_by(VideoRenderTask.created_at.desc())
    )
    render_task = result.scalars().first()
    if not render_task or render_task.status != RenderTaskStatus.COMPLETED:
        raise HTTPException(404, "Video not ready")
    if not render_task.final_video_url:
        raise HTTPException(404, "Video file missing")

    video_path = Path(render_task.final_video_url).resolve()
    output_root = Path(settings.video_output_dir).resolve()
    if not str(video_path).startswith(str(output_root)):
        raise HTTPException(403, "Access denied")
    if not video_path.is_file():
        raise HTTPException(404, "Video file not found")

    return FileResponse(
        video_path,
        media_type="video/mp4",
        filename=f"{campaign_id}.mp4",
        headers={"Cache-Control": "private, max-age=3600"},
    )
