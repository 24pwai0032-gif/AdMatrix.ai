"""Tests for campaign state machine."""

import pytest

from app.models.schemas import CampaignState
from app.state_machine import InvalidStateTransition, require_state


def test_approve_requires_awaiting_approval():
    require_state("approve", CampaignState.AWAITING_APPROVAL)


def test_render_requires_approved():
    require_state("render", CampaignState.APPROVED)


def test_render_rejected_from_draft():
    with pytest.raises(InvalidStateTransition) as exc:
        require_state("render", CampaignState.DRAFT)
    assert exc.value.current == CampaignState.DRAFT
