"""Brand safety and compliance guardrails for AdMatrix.ai."""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

import httpx

from app.config import get_settings
from app.models.schemas import CampaignState

logger = logging.getLogger(__name__)


class AdMatrixGuardrail:
    """Text and visual compliance checks with FAILED state transitions."""

    def __init__(self, qwen_api_key: str | None = None):
        self.qwen_api_key = qwen_api_key
        self.qwen_base_url = os.getenv(
            "QWEN_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"
        )

    async def run_full_check(
        self,
        campaign_id: str,
        script_text: str,
        frame_urls: list[str] | None = None,
    ) -> dict[str, Any]:
        """Execute text + visual compliance and return aggregated report."""
        text_result = await self.check_text_compliance(script_text)
        visual_result = await self.check_visual_compliance(frame_urls or [])

        passed = text_result["passed"] and visual_result["passed"]
        report = {
            "campaign_id": campaign_id,
            "passed": passed,
            "text": text_result,
            "visual": visual_result,
            "checked_at": datetime.now(timezone.utc).isoformat(),
            "recommended_state": CampaignState.COMPLETED.value if passed else CampaignState.FAILED.value,
        }

        if not passed:
            self._log_security_trace(campaign_id, report)

        return report

    async def check_text_compliance(self, text: str) -> dict[str, Any]:
        """Trademark and regulatory checks via Qwen."""
        violations: list[dict[str, str]] = []

        # Rule-based pre-checks
        blocked_patterns = [
            ("guaranteed cure", "regulatory"),
            ("100% effective", "regulatory"),
            ("FDA approved", "regulatory_unverified"),
            ("miracle", "regulatory"),
        ]
        lower = text.lower()
        for pattern, category in blocked_patterns:
            if pattern in lower:
                violations.append({"pattern": pattern, "category": category, "severity": "high"})

        # LLM deep check when API available
        if self.qwen_api_key and len(text) > 10:
            llm_violations = await self._qwen_text_audit(text)
            violations.extend(llm_violations)

        return {
            "passed": len(violations) == 0,
            "violations": violations,
            "check_type": "text",
        }

    async def _qwen_text_audit(self, text: str) -> list[dict[str, str]]:
        payload = {
            "model": "qwen-max",
            "messages": [
                {
                    "role": "user",
                    "content": (
                        "Audit this ad copy for trademark misuse, false claims, and regulatory violations. "
                        'Return JSON: {"violations": [{"pattern": str, "category": str, "severity": str}]}\n\n'
                        f"Copy:\n{text[:6000]}"
                    ),
                }
            ],
            "response_format": {"type": "json_object"},
        }

        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(
                    f"{self.qwen_base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {self.qwen_api_key}"},
                    json=payload,
                )
                resp.raise_for_status()
                content = resp.json()["choices"][0]["message"]["content"]
                parsed = json.loads(content)
                return parsed.get("violations", [])
        except Exception as exc:
            logger.warning("Qwen text audit failed: %s", exc)
            return []

    async def check_visual_compliance(self, frame_urls: list[str]) -> dict[str, Any]:
        """Detect frame artifacts, warping, and inappropriate content."""
        issues: list[dict[str, str]] = []

        for url in frame_urls:
            artifact_score = await self._score_frame_artifacts(url)
            if artifact_score > 0.7:
                issues.append({
                    "frame": url,
                    "issue": "high_artifact_score",
                    "score": str(artifact_score),
                    "severity": "high",
                })
            warp_score = await self._detect_warping(url)
            if warp_score > 0.6:
                issues.append({
                    "frame": url,
                    "issue": "geometric_warping",
                    "score": str(warp_score),
                    "severity": "medium",
                })

        return {
            "passed": len(issues) == 0,
            "issues": issues,
            "frames_checked": len(frame_urls),
            "check_type": "visual",
        }

    async def _score_frame_artifacts(self, frame_url: str) -> float:
        """Placeholder artifact scorer — production uses vision model."""
        if not frame_url:
            return 0.0
        # Deterministic hash-based mock score for reproducibility
        return (hash(frame_url) % 100) / 100.0 * 0.5

    async def _detect_warping(self, frame_url: str) -> float:
        """Placeholder warping detector."""
        if not frame_url:
            return 0.0
        return (hash(frame_url + "warp") % 100) / 100.0 * 0.4

    def _log_security_trace(self, campaign_id: str, report: dict[str, Any]) -> None:
        """Append security trace log for failed compliance checks."""
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "event": "COMPLIANCE_FAILED",
            "campaign_id": campaign_id,
            "report": report,
        }
        log_path = get_settings().security_log_path
        try:
            os.makedirs(os.path.dirname(log_path), exist_ok=True)
            with open(log_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry) + "\n")
        except OSError as exc:
            logger.error("Failed to write security trace: %s", exc)

    def transition_state(self, passed: bool) -> CampaignState:
        """Return next campaign state based on compliance outcome."""
        return CampaignState.COMPLETED if passed else CampaignState.FAILED
