"""Scene-level timeline editor — patch individual scenes and re-render in isolation."""

from __future__ import annotations

import logging
import os
import subprocess
import tempfile
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.schemas import Campaign, VideoRenderTask, VideoStoryboard
from app.utils.security import escape_ffmpeg_drawtext

logger = logging.getLogger(__name__)
OUTPUT_DIR = Path(os.getenv("VIDEO_OUTPUT_DIR", "/tmp/admatrix/videos"))


class TimelineEditorService:
    """Patch storyboard scenes and splice re-rendered segments into the final video."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def patch_scene(
        self,
        campaign_id: uuid.UUID,
        scene_id: str,
        patch: dict[str, Any],
    ) -> dict[str, Any]:
        """Update a single scene and trigger isolated re-render + ffmpeg splice."""
        campaign = await self._get_campaign(campaign_id)
        storyboard = await self._get_storyboard(campaign_id)

        scenes = list(storyboard.scenes or [])
        scene_idx = next((i for i, s in enumerate(scenes) if s.get("scene_id") == scene_id), None)
        if scene_idx is None:
            raise ValueError(f"Scene {scene_id} not found in campaign {campaign_id}")

        updated_scene = {**scenes[scene_idx]}
        for key in ("narration", "visual_prompt", "duration_sec", "panel_image_url"):
            if key in patch and patch[key] is not None:
                updated_scene[key] = patch[key]
        scenes[scene_idx] = updated_scene
        storyboard.scenes = scenes
        flag_modified(storyboard, "scenes")

        re_rendered_clip = await self._re_render_scene(campaign_id, updated_scene)
        final_url = await self._splice_into_final(campaign_id, scene_idx, re_rendered_clip, scenes)

        storyboard.scenes[scene_idx]["video_clip_url"] = re_rendered_clip
        await self.db.commit()

        return {
            "campaign_id": str(campaign_id),
            "scene_id": scene_id,
            "scene": updated_scene,
            "re_rendered_clip": re_rendered_clip,
            "final_video_url": final_url,
            "campaign_state": campaign.state.value,
        }

    async def _get_campaign(self, campaign_id: uuid.UUID) -> Campaign:
        result = await self.db.execute(select(Campaign).where(Campaign.id == campaign_id))
        campaign = result.scalar_one_or_none()
        if not campaign:
            raise ValueError(f"Campaign {campaign_id} not found")
        return campaign

    async def _get_storyboard(self, campaign_id: uuid.UUID) -> VideoStoryboard:
        result = await self.db.execute(
            select(VideoStoryboard).where(VideoStoryboard.campaign_id == campaign_id)
        )
        storyboard = result.scalar_one_or_none()
        if not storyboard:
            raise ValueError(f"No storyboard for campaign {campaign_id}")
        return storyboard

    async def _re_render_scene(self, campaign_id: uuid.UUID, scene: dict[str, Any]) -> str:
        """Re-render a single scene clip without touching other segments."""
        clip_path = OUTPUT_DIR / f"{campaign_id}_scene_{scene['scene_id']}_patch.mp4"
        duration = scene.get("duration_sec", 3.0)
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

        safe_text = escape_ffmpeg_drawtext(scene.get("narration", ""))
        try:
            subprocess.run(
                [
                    "ffmpeg", "-y",
                    "-f", "lavfi",
                    "-i", f"color=c=0x16213e:s=1080x1920:d={duration}",
                    "-vf", f"drawtext=text='{safe_text}':fontsize=32:fontcolor=white:x=40:y=h-120",
                    "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    str(clip_path),
                ],
                capture_output=True,
                timeout=60,
                check=True,
            )
        except (subprocess.CalledProcessError, FileNotFoundError) as exc:
            logger.warning("Scene re-render fallback: %s", exc)
            clip_path.touch()

        return str(clip_path)

    async def _splice_into_final(
        self,
        campaign_id: uuid.UUID,
        scene_idx: int,
        new_clip: str,
        scenes: list[dict[str, Any]],
    ) -> str:
        """Replace one segment in the final video via ffmpeg concat splice."""
        final_path = OUTPUT_DIR / f"{campaign_id}_final_spliced.mp4"

        clips: list[str] = []
        for i, scene in enumerate(scenes):
            if i == scene_idx:
                clips.append(new_clip)
            elif scene.get("video_clip_url"):
                clips.append(scene["video_clip_url"])
            elif scene.get("synced_clip_url"):
                clips.append(scene["synced_clip_url"])

        if len(clips) <= 1:
            return new_clip

        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False) as manifest:
            for clip in clips:
                manifest.write(f"file '{clip}'\n")
            manifest_path = manifest.name

        try:
            subprocess.run(
                [
                    "ffmpeg", "-y",
                    "-f", "concat", "-safe", "0",
                    "-i", manifest_path,
                    "-c", "copy",
                    str(final_path),
                ],
                capture_output=True,
                timeout=120,
                check=True,
            )
        except (subprocess.CalledProcessError, FileNotFoundError):
            return new_clip
        finally:
            Path(manifest_path).unlink(missing_ok=True)

        # Update render task record
        result = await self.db.execute(
            select(VideoRenderTask).where(VideoRenderTask.campaign_id == campaign_id)
        )
        render_task = result.scalar_one_or_none()
        if render_task:
            render_task.final_video_url = str(final_path)

        return str(final_path)
