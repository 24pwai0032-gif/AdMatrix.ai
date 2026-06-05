"""Campaign state transition validation."""

from __future__ import annotations

from app.models.schemas import CampaignState

# Maps current state → allowed target states per action
ACTION_REQUIRED_STATES: dict[str, set[CampaignState]] = {
    "script": {CampaignState.INGESTING, CampaignState.DRAFT, CampaignState.AWAITING_APPROVAL},
    "approve": {CampaignState.AWAITING_APPROVAL},
    "render": {CampaignState.APPROVED},
    "compliance": {CampaignState.RENDERING, CampaignState.APPROVED},
    "patch_scene": {CampaignState.APPROVED, CampaignState.RENDERING, CampaignState.COMPLETED},
}


class InvalidStateTransition(Exception):
    def __init__(self, action: str, current: CampaignState, allowed: set[CampaignState]):
        self.action = action
        self.current = current
        self.allowed = allowed
        super().__init__(
            f"Action '{action}' not allowed in state '{current.value}'. "
            f"Allowed states: {[s.value for s in allowed]}"
        )


def require_state(action: str, current: CampaignState) -> None:
    allowed = ACTION_REQUIRED_STATES.get(action, set())
    if current not in allowed:
        raise InvalidStateTransition(action, current, allowed)
