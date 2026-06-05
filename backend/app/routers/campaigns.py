"""Campaign lifecycle endpoints."""

from __future__ import annotations

import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.agents.script_workflow import run_script_workflow
from app.config import get_settings
from app.database import get_db
from app.middleware.compliance import AdMatrixGuardrail
from app.middleware.telemetry import TokenUsageTracker
from app.models.schemas import (
    ApprovalRequest,
    Campaign,
    CampaignCreate,
    CampaignRead,
    CampaignState,
    CompanyProduct,
    RenderTaskStatus,
    ScenePatchRequest,
    VideoRenderTask,
    VideoRenderTaskRead,
    VideoStoryboard,
    VideoStoryboardRead,
    VideoUrlResponse,
)
from app.services.timeline_editor import TimelineEditorService
from app.state_machine import InvalidStateTransition, require_state
from app.tasks.video_pipeline import launch_video_pipeline
from app.utils.signing import SignatureError, build_signed_video_url, verify_resource_signature

router = APIRouter(prefix="/api/v1/campaigns", tags=["campaigns"])
logger = logging.getLogger(__name__)
settings = get_settings()


@router.post("", response_model=CampaignRead)
async def create_campaign(body: CampaignCreate, db: AsyncSession = Depends(get_db)):
    if body.primary_locale not in body.target_locales:
        raise HTTPException(
            status_code=400,
            detail="primary_locale must be included in target_locales",
        )

    product = await db.get(CompanyProduct, body.product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    campaign = Campaign(
        product_id=body.product_id,
        target_locales=body.target_locales,
        primary_locale=body.primary_locale,
        budget_usd=body.budget_usd,
        state=CampaignState.INGESTING,
    )
    db.add(campaign)
    await db.commit()
    await db.refresh(campaign)
    return campaign


@router.get("/{campaign_id}", response_model=CampaignRead)
async def get_campaign(campaign_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    return campaign


@router.post("/{campaign_id}/script")
async def run_scripting(campaign_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    require_state("script", campaign.state)

    product = await db.get(CompanyProduct, campaign.product_id)
    if not product:
        raise HTTPException(404, "Product not found")

    campaign.state = CampaignState.SCRIPTING
    await db.commit()

    try:
        result = await run_script_workflow(
            campaign_id=str(campaign_id),
            brand_book=product.brand_book or {},
            cleaned_text=product.cleaned_text or "",
            target_locales=campaign.target_locales or ["en-US"],
            locale=campaign.primary_locale,
            revision_count=campaign.revision_count,
        )
    except Exception as exc:
        campaign.state = CampaignState.FAILED
        await db.commit()
        logger.exception("Script workflow failed for %s", campaign_id)
        raise HTTPException(status_code=500, detail="Script generation failed") from exc

    campaign.script_draft = result.get("script_draft", {})
    campaign.transcreated_scripts = result.get("transcreated_scripts", {})
    campaign.state = CampaignState.AWAITING_APPROVAL

    storyboard_data = result.get("storyboard", {})
    await _upsert_storyboard(db, campaign_id, campaign.primary_locale, storyboard_data)
    await db.commit()

    return {
        "campaign_id": str(campaign_id),
        "state": campaign.state.value,
        "storyboard": storyboard_data,
    }


@router.post("/{campaign_id}/approve")
async def approve_storyboard(
    campaign_id: uuid.UUID,
    body: ApprovalRequest,
    db: AsyncSession = Depends(get_db),
):
    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    require_state("approve", campaign.state)

    product = await db.get(CompanyProduct, campaign.product_id)

    if body.action == "REJECT":
        if campaign.revision_count >= settings.max_revisions:
            campaign.state = CampaignState.FAILED
            await db.commit()
            raise HTTPException(status_code=409, detail="Maximum revision limit reached")

        campaign.revision_count += 1
        campaign.approval_notes = body.notes
        result = await run_script_workflow(
            campaign_id=str(campaign_id),
            brand_book=(product.brand_book or {}) if product else {},
            cleaned_text=(product.cleaned_text or "") if product else "",
            target_locales=campaign.target_locales or ["en-US"],
            locale=campaign.primary_locale,
            hitl_action="REJECT",
            approval_notes=body.notes,
            revision_count=campaign.revision_count,
        )
        campaign.script_draft = result.get("script_draft", {})
        campaign.state = CampaignState.AWAITING_APPROVAL
        storyboard_data = result.get("storyboard", {})
        await _upsert_storyboard(db, campaign_id, campaign.primary_locale, storyboard_data)
        await db.commit()
        return {"status": "revised", "revision_count": campaign.revision_count}

    campaign.state = CampaignState.APPROVED
    campaign.approval_notes = body.notes
    existing = await db.execute(
        select(VideoStoryboard).where(VideoStoryboard.campaign_id == campaign_id)
    )
    storyboard = existing.scalar_one_or_none()
    if storyboard:
        storyboard.hitl_status = "approved"
    await db.commit()
    return {"status": "approved", "campaign_id": str(campaign_id)}


@router.post("/{campaign_id}/render")
async def start_render(campaign_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    require_state("render", campaign.state)

    tracker = TokenUsageTracker(db)
    gate = await tracker.check_budget_gate(campaign_id, estimated_additional_cost=2.5)
    if not gate["allowed"]:
        raise HTTPException(402, detail=gate)

    result = await db.execute(
        select(VideoStoryboard).where(VideoStoryboard.campaign_id == campaign_id)
    )
    storyboard = result.scalar_one_or_none()
    if not storyboard:
        raise HTTPException(404, "Storyboard not found")

    scenes = storyboard.scenes or []
    if not scenes:
        raise HTTPException(status_code=400, detail="Storyboard has no scenes")

    task_id = launch_video_pipeline(
        str(campaign_id),
        campaign.primary_locale,
        scenes,
        storyboard.panel_images or [],
    )

    render_task = VideoRenderTask(
        campaign_id=campaign_id,
        storyboard_id=storyboard.id,
        locale=campaign.primary_locale,
        celery_task_id=task_id,
        status=RenderTaskStatus.PROCESSING,
    )
    campaign.state = CampaignState.RENDERING
    db.add(render_task)
    await db.commit()

    return {"task_id": task_id, "state": campaign.state.value}


@router.get("/{campaign_id}/render", response_model=VideoRenderTaskRead)
async def get_render_status(campaign_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    render_task = await _latest_render_task(db, campaign_id)
    if not render_task:
        raise HTTPException(404, "No render task found")
    return render_task


@router.get("/{campaign_id}/video-url", response_model=VideoUrlResponse)
async def get_video_url(
    campaign_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    base_url: str = Query("http://localhost:8000", description="Public API base URL"),
):
    render_task = await _latest_render_task(db, campaign_id)
    if not render_task or render_task.status != RenderTaskStatus.COMPLETED:
        raise HTTPException(404, "Video not ready")

    secret = settings.signing_secret
    if not secret:
        url = f"{base_url.rstrip('/')}/api/v1/videos/{campaign_id}"
    else:
        url = build_signed_video_url(base_url, campaign_id, secret, settings.video_url_ttl_seconds)

    return VideoUrlResponse(
        campaign_id=campaign_id,
        video_url=url,
        expires_in_seconds=settings.video_url_ttl_seconds if secret else None,
    )


@router.patch("/{campaign_id}/scenes/{scene_id}")
async def patch_scene(
    campaign_id: uuid.UUID,
    scene_id: str,
    body: ScenePatchRequest,
    db: AsyncSession = Depends(get_db),
):
    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    require_state("patch_scene", campaign.state)

    patch_data = body.model_dump(exclude_none=True)
    if not patch_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    editor = TimelineEditorService(db)
    try:
        return await editor.patch_scene(campaign_id, scene_id, patch_data)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post("/{campaign_id}/compliance")
async def run_compliance(campaign_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    campaign = await db.get(Campaign, campaign_id)
    if not campaign:
        raise HTTPException(404, "Campaign not found")
    require_state("compliance", campaign.state)

    campaign.state = CampaignState.COMPLIANCE_CHECK
    script = campaign.script_draft or {}
    narration = " ".join(s.get("narration", "") for s in script.get("scenes", []))

    result = await db.execute(
        select(VideoStoryboard).where(VideoStoryboard.campaign_id == campaign_id)
    )
    storyboard = result.scalar_one_or_none()
    frames = storyboard.panel_images if storyboard else []

    guardrail = AdMatrixGuardrail(qwen_api_key=settings.qwen_api_key)
    report = await guardrail.run_full_check(str(campaign_id), narration, frames)

    campaign.compliance_report = report
    campaign.state = guardrail.transition_state(report["passed"])
    await db.commit()
    return report


@router.get("/{campaign_id}/storyboard", response_model=VideoStoryboardRead)
async def get_storyboard(campaign_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(VideoStoryboard).where(VideoStoryboard.campaign_id == campaign_id)
    )
    storyboard = result.scalar_one_or_none()
    if not storyboard:
        raise HTTPException(404, "Storyboard not found")
    return storyboard


async def _upsert_storyboard(
    db: AsyncSession,
    campaign_id: uuid.UUID,
    locale: str,
    storyboard_data: dict,
) -> None:
    existing = await db.execute(
        select(VideoStoryboard).where(VideoStoryboard.campaign_id == campaign_id)
    )
    storyboard = existing.scalar_one_or_none()
    if storyboard:
        storyboard.scenes = storyboard_data.get("scenes", [])
        storyboard.narrative = storyboard_data.get("narrative")
        storyboard.panel_images = storyboard_data.get("panel_images", [])
        storyboard.hitl_status = storyboard_data.get("hitl_status", "pending")
        flag_modified(storyboard, "scenes")
        flag_modified(storyboard, "panel_images")
    else:
        db.add(
            VideoStoryboard(
                campaign_id=campaign_id,
                locale=locale,
                scenes=storyboard_data.get("scenes", []),
                narrative=storyboard_data.get("narrative"),
                panel_images=storyboard_data.get("panel_images", []),
                hitl_status=storyboard_data.get("hitl_status", "pending"),
            )
        )


async def _latest_render_task(db: AsyncSession, campaign_id: uuid.UUID) -> VideoRenderTask | None:
    result = await db.execute(
        select(VideoRenderTask)
        .where(VideoRenderTask.campaign_id == campaign_id)
        .order_by(VideoRenderTask.created_at.desc())
    )
    return result.scalars().first()
