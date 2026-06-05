"""LangGraph creative orchestration loop with HITL approval gate."""

from __future__ import annotations

import json
import logging
import uuid
from typing import Annotated, Any, Literal, TypedDict

from langgraph.graph import END, StateGraph
from langgraph.graph.message import add_messages

logger = logging.getLogger(__name__)

MAX_REVISIONS = 5


class ScriptWorkflowState(TypedDict, total=False):
    campaign_id: str
    locale: str
    target_locales: list[str]
    brand_book: dict[str, Any]
    cleaned_text: str
    script_draft: dict[str, Any]
    transcreated_scripts: dict[str, Any]
    storyboard: dict[str, Any]
    revision_count: int
    hitl_action: Literal["APPROVE", "REJECT", "PENDING"]
    approval_notes: str | None
    messages: Annotated[list, add_messages]
    error: str | None


async def scripting_agent(state: ScriptWorkflowState) -> dict[str, Any]:
    """Generate initial ad script from product data and brand book."""
    brand = state.get("brand_book", {})
    selling_points = brand.get("key_selling_points", ["quality", "value"])
    product_context = state.get("cleaned_text", "")[:4000]

    scenes = []
    hooks = [
        f"Discover why {brand.get('product_name', 'this product')} is changing the game.",
        f"Built for {brand.get('target_audience', 'modern consumers')}.",
        f"Experience {selling_points[0] if selling_points else 'innovation'} like never before.",
        "Ready to transform your routine? Watch until the end.",
    ]

    for i, hook in enumerate(hooks):
        scenes.append(
            {
                "scene_id": str(uuid.uuid4()),
                "order": i,
                "narration": hook,
                "visual_prompt": (
                    f"9:16 vertical ad shot, scene {i + 1}, "
                    f"{brand.get('typography_style', 'modern')} aesthetic, "
                    f"colors {', '.join(brand.get('color_palette', ['#1a1a2e'])[:3])}, "
                    f"product showcase: {hook[:80]}"
                ),
                "duration_sec": 3.0,
            }
        )

    script_draft = {
        "locale": state.get("locale", "en-US"),
        "hook": hooks[0],
        "cta": "Shop now — limited time offer.",
        "scenes": scenes,
        "brand_voice": brand.get("brand_voice", "professional"),
    }

    return {
        "script_draft": script_draft,
        "messages": [{"role": "assistant", "content": f"Script drafted with {len(scenes)} scenes."}],
    }


async def transcreation_agent(state: ScriptWorkflowState) -> dict[str, Any]:
    """Dual-pass cultural translation for each target locale."""
    script = state.get("script_draft", {})
    source_locale = script.get("locale", "en-US")
    target_locales = state.get("target_locales", [])
    transcreated: dict[str, Any] = {}

    locale_adaptations = {
        "zh-CN": {"cta": "立即购买 — 限时优惠。", "tone": "respectful, aspirational"},
        "ja-JP": {"cta": "今すぐ購入 — 期間限定。", "tone": "polite, precise"},
        "ar-SA": {"cta": "تسوق الآن — عرض لفترة محدودة.", "tone": "formal, warm"},
        "es-MX": {"cta": "Compra ahora — oferta por tiempo limitado.", "tone": "energetic, friendly"},
        "en-US": {"cta": script.get("cta", "Shop now."), "tone": "direct, upbeat"},
    }

    for locale in target_locales:
        if locale == source_locale:
            transcreated[locale] = script
            continue

        adaptation = locale_adaptations.get(locale, locale_adaptations["en-US"])
        localized_scenes = []

        for scene in script.get("scenes", []):
            narration = scene["narration"]
            # Pass 1: literal translation placeholder
            pass1 = f"[{locale}] {narration}"
            # Pass 2: cultural adaptation
            pass2 = pass1.replace("Discover", "Experience").replace("game", "market")

            localized_scenes.append(
                {
                    **scene,
                    "scene_id": str(uuid.uuid4()),
                    "narration": pass2,
                    "visual_prompt": (
                        f"{scene['visual_prompt']}, culturally adapted for {locale}, "
                        f"tone: {adaptation['tone']}"
                    ),
                }
            )

        transcreated[locale] = {
            **script,
            "locale": locale,
            "cta": adaptation["cta"],
            "scenes": localized_scenes,
            "cultural_notes": state.get("brand_book", {}).get("cultural_notes", ""),
            "transcreation_passes": 2,
        }

    return {
        "transcreated_scripts": transcreated,
        "messages": [{"role": "assistant", "content": f"Transcreated to {len(transcreated)} locales."}],
    }


async def storyboard_generator(state: ScriptWorkflowState) -> dict[str, Any]:
    """Build visual storyboard with 4 panel images from script scenes."""
    locale = state.get("locale", "en-US")
    scripts = state.get("transcreated_scripts", {})
    script = scripts.get(locale) or state.get("script_draft", {})
    scenes = script.get("scenes", [])[:4]

    panel_images = [f"/api/v1/assets/panel/{s['scene_id']}.jpg" for s in scenes]
    narrative = " ".join(s["narration"] for s in scenes)

    storyboard = {
        "locale": locale,
        "scenes": scenes,
        "narrative": narrative,
        "panel_images": panel_images,
        "hitl_status": "pending",
    }

    return {
        "storyboard": storyboard,
        "messages": [{"role": "assistant", "content": "Storyboard generated — awaiting human approval."}],
    }


async def human_approval_gate(state: ScriptWorkflowState) -> dict[str, Any]:
    """Evaluate HITL decision; increment revision counter on reject."""
    action = state.get("hitl_action", "PENDING")
    revision_count = state.get("revision_count", 0)

    if action == "REJECT":
        revision_count += 1
        return {
            "revision_count": revision_count,
            "hitl_action": "PENDING",
            "messages": [
                {
                    "role": "user",
                    "content": f"Rejected (revision {revision_count}): {state.get('approval_notes', '')}",
                }
            ],
        }

    if action == "APPROVE":
        storyboard = state.get("storyboard", {})
        storyboard["hitl_status"] = "approved"
        return {
            "storyboard": storyboard,
            "messages": [{"role": "user", "content": "Storyboard approved."}],
        }

    return {"messages": [{"role": "system", "content": "Awaiting human approval."}]}


def route_after_approval(state: ScriptWorkflowState) -> str:
    """Conditional routing: APPROVE → end, REJECT → re-script, PENDING → interrupt."""
    action = state.get("hitl_action", "PENDING")
    revision_count = state.get("revision_count", 0)

    if action == "APPROVE":
        return "approved"
    if action == "REJECT":
        if revision_count >= MAX_REVISIONS:
            return "max_revisions"
        return "revise"
    return "awaiting"


def build_script_workflow() -> StateGraph:
    """Construct the LangGraph StateGraph for creative orchestration."""
    graph = StateGraph(ScriptWorkflowState)

    graph.add_node("scripting_agent", scripting_agent)
    graph.add_node("transcreation_agent", transcreation_agent)
    graph.add_node("storyboard_generator", storyboard_generator)
    graph.add_node("human_approval_gate", human_approval_gate)

    graph.set_entry_point("scripting_agent")
    graph.add_edge("scripting_agent", "transcreation_agent")
    graph.add_edge("transcreation_agent", "storyboard_generator")
    graph.add_edge("storyboard_generator", "human_approval_gate")

    graph.add_conditional_edges(
        "human_approval_gate",
        route_after_approval,
        {
            "approved": END,
            "revise": "scripting_agent",
            "awaiting": END,
            "max_revisions": END,
        },
    )

    return graph


compiled_workflow = build_script_workflow().compile()


async def run_script_workflow(
    campaign_id: str,
    brand_book: dict[str, Any],
    cleaned_text: str,
    target_locales: list[str],
    locale: str = "en-US",
    hitl_action: str = "PENDING",
    approval_notes: str | None = None,
    revision_count: int = 0,
) -> ScriptWorkflowState:
    """Execute the full creative orchestration loop."""
    initial: ScriptWorkflowState = {
        "campaign_id": campaign_id,
        "locale": locale,
        "target_locales": target_locales,
        "brand_book": brand_book,
        "cleaned_text": cleaned_text,
        "revision_count": revision_count,
        "hitl_action": hitl_action,  # type: ignore[typeddict-item]
        "approval_notes": approval_notes,
        "messages": [],
    }

    result = await compiled_workflow.ainvoke(initial)
    logger.info("Workflow complete for campaign %s: %s", campaign_id, json.dumps({"revision_count": result.get("revision_count")}))
    return result
