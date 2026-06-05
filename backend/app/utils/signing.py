"""HMAC-signed URLs for resources that cannot send auth headers (e.g. <video src>)."""

from __future__ import annotations

import hashlib
import hmac
import time
from uuid import UUID


class SignatureError(ValueError):
    pass


def _secret(secret: str | None) -> str:
    if not secret:
        raise SignatureError("Signing secret not configured")
    return secret


def sign_resource(resource_id: str | UUID, secret: str, ttl_seconds: int = 3600) -> tuple[int, str]:
    """Return (expiry_unix, signature_hex) for a resource."""
    exp = int(time.time()) + ttl_seconds
    msg = f"{resource_id}:{exp}"
    sig = hmac.new(_secret(secret).encode(), msg.encode(), hashlib.sha256).hexdigest()
    return exp, sig


def verify_resource_signature(
    resource_id: str | UUID,
    exp: int,
    sig: str,
    secret: str,
) -> None:
    if int(time.time()) > exp:
        raise SignatureError("Signature expired")
    msg = f"{resource_id}:{exp}"
    expected = hmac.new(_secret(secret).encode(), msg.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        raise SignatureError("Invalid signature")


def build_signed_video_url(
    base_url: str,
    campaign_id: str | UUID,
    secret: str,
    ttl_seconds: int = 3600,
) -> str:
    exp, sig = sign_resource(campaign_id, secret, ttl_seconds)
    return f"{base_url.rstrip('/')}/api/v1/videos/{campaign_id}?exp={exp}&sig={sig}"
