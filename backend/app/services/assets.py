"""Asset storage helpers — keep DB lean by excluding heavy payloads."""

from __future__ import annotations

from typing import Any


def slim_image_assets(image_assets: dict[str, Any] | None) -> dict[str, Any]:
    """Strip base64 blobs before persistence; retain URLs and dimensions."""
    if not image_assets:
        return {"images": []}
    slimmed = []
    for img in image_assets.get("images", []):
        slimmed.append({k: v for k, v in img.items() if k != "base64"})
    return {"images": slimmed, "count": len(slimmed)}
