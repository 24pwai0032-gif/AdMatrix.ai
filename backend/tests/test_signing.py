"""Tests for signed video URL utilities."""

import hashlib
import hmac
import time

import pytest

from app.utils.signing import SignatureError, sign_resource, verify_resource_signature


def test_sign_and_verify():
    exp, sig = sign_resource("campaign-123", "test-secret", ttl_seconds=60)
    verify_resource_signature("campaign-123", exp, sig, "test-secret")


def test_reject_tampered_signature():
    exp, sig = sign_resource("campaign-123", "test-secret")
    with pytest.raises(SignatureError):
        verify_resource_signature("campaign-123", exp, sig + "x", "test-secret")


def test_reject_expired_signature():
    exp = int(time.time()) - 10
    msg = f"campaign-123:{exp}"
    sig = hmac.new(b"test-secret", msg.encode(), hashlib.sha256).hexdigest()
    with pytest.raises(SignatureError):
        verify_resource_signature("campaign-123", exp, sig, "test-secret")
