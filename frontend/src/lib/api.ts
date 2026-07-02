/**
 * AdMatrix.ai — Live API client
 *
 * Wraps every backend endpoint needed by the dashboard pipeline.
 * All calls read NEXT_PUBLIC_API_URL and optionally send X-API-Key.
 *
 * Used only when NEXT_PUBLIC_DEMO_MODE !== "true".
 */

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

const API_KEY = process.env.NEXT_PUBLIC_API_KEY ?? "";

// ─── Shared fetch helper ───────────────────────────────────────────────────

async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(API_KEY ? { "X-API-Key": API_KEY } : {}),
    ...(options.headers ?? {}),
  };

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body?.detail ?? JSON.stringify(body) ?? detail;
      if (typeof detail === "object") detail = JSON.stringify(detail);
    } catch {
      // ignore parse error
    }
    throw new ApiError(res.status, detail);
  }

  // 204 No Content
  if (res.status === 204) return undefined as T;

  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

// ─── Backend response types ────────────────────────────────────────────────

export interface ProductRead {
  id: string;
  source_url: string;
  company_name: string | null;
  product_name: string | null;
  brand_book: BrandBookRaw | null;
  image_assets: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface BrandBookRaw {
  brand_voice?: string;
  color_palette?: string[];
  key_selling_points?: string[];
  tagline?: string;
  tone?: string;
  audience?: string;
  [key: string]: unknown;
}

export interface CampaignRead {
  id: string;
  product_id: string;
  state: CampaignState;
  target_locales: string[];
  primary_locale: string;
  budget_usd: number;
  revision_count: number;
  script_draft: Record<string, unknown> | null;
  transcreated_scripts: Record<string, unknown> | null;
  compliance_report: Record<string, unknown> | null;
  approval_notes: string | null;
  created_at: string;
  updated_at: string;
}

export type CampaignState =
  | "ingesting"
  | "scripting"
  | "awaiting_approval"
  | "approved"
  | "rendering"
  | "compliance_check"
  | "completed"
  | "failed";

export interface StoryboardScene {
  id: string;
  order: number;
  visual_prompt: string;
  duration_sec: number;
  narration: Record<string, string>;
}

export interface StoryboardRead {
  id: string;
  campaign_id: string;
  locale: string;
  scenes: StoryboardScene[];
  narrative: string | null;
  panel_images: string[];
  hitl_status: string;
  created_at: string;
  updated_at: string;
}

export interface ScriptResult {
  campaign_id: string;
  state: CampaignState;
  storyboard: {
    scenes: StoryboardScene[];
    narrative?: string;
    panel_images?: string[];
    hitl_status?: string;
  };
}

export interface ApproveResult {
  status: "approved" | "revised";
  campaign_id?: string;
  revision_count?: number;
}

export interface RenderTaskRead {
  id: string;
  campaign_id: string;
  celery_task_id: string;
  status: "pending" | "processing" | "completed" | "failed";
  locale: string;
  final_video_url: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface VideoUrlResponse {
  campaign_id: string;
  video_url: string;
  expires_in_seconds: number | null;
}

// ─── Endpoint wrappers ─────────────────────────────────────────────────────

/** POST /api/v1/ingest — scrape product page and return brand data */
export async function ingestProduct(sourceUrl: string): Promise<ProductRead> {
  return apiFetch<ProductRead>("/api/v1/ingest", {
    method: "POST",
    body: JSON.stringify({ source_url: sourceUrl }),
  });
}

/** POST /api/v1/campaigns — create a campaign for the ingested product */
export async function createCampaign(
  productId: string,
  targetLocales: string[],
  primaryLocale: string,
  budgetUsd = 10,
): Promise<CampaignRead> {
  return apiFetch<CampaignRead>("/api/v1/campaigns", {
    method: "POST",
    body: JSON.stringify({
      product_id: productId,
      target_locales: targetLocales,
      primary_locale: primaryLocale,
      budget_usd: budgetUsd,
    }),
  });
}

/** GET /api/v1/campaigns/{id} — fetch current campaign state */
export async function getCampaign(campaignId: string): Promise<CampaignRead> {
  return apiFetch<CampaignRead>(`/api/v1/campaigns/${campaignId}`);
}

/** POST /api/v1/campaigns/{id}/script — trigger script + storyboard generation */
export async function runScript(campaignId: string): Promise<ScriptResult> {
  return apiFetch<ScriptResult>(`/api/v1/campaigns/${campaignId}/script`, {
    method: "POST",
  });
}

/** GET /api/v1/campaigns/{id}/storyboard — fetch the storyboard after scripting */
export async function getStoryboard(
  campaignId: string,
): Promise<StoryboardRead> {
  return apiFetch<StoryboardRead>(
    `/api/v1/campaigns/${campaignId}/storyboard`,
  );
}

/** POST /api/v1/campaigns/{id}/approve — approve (or reject) the storyboard */
export async function approveCampaign(
  campaignId: string,
  action: "APPROVE" | "REJECT",
  notes?: string,
): Promise<ApproveResult> {
  return apiFetch<ApproveResult>(`/api/v1/campaigns/${campaignId}/approve`, {
    method: "POST",
    body: JSON.stringify({ action, notes: notes ?? "" }),
  });
}

/** POST /api/v1/campaigns/{id}/render — kick off the Celery video pipeline */
export async function startRender(
  campaignId: string,
): Promise<{ task_id: string; state: CampaignState }> {
  return apiFetch(`/api/v1/campaigns/${campaignId}/render`, {
    method: "POST",
  });
}

/** GET /api/v1/campaigns/{id}/render — poll render task status */
export async function getRenderStatus(
  campaignId: string,
): Promise<RenderTaskRead> {
  return apiFetch<RenderTaskRead>(`/api/v1/campaigns/${campaignId}/render`);
}

/** GET /api/v1/campaigns/{id}/video-url — get signed video URL after completion */
export async function getVideoUrl(
  campaignId: string,
): Promise<VideoUrlResponse> {
  const baseUrl = API_BASE;
  return apiFetch<VideoUrlResponse>(
    `/api/v1/campaigns/${campaignId}/video-url?base_url=${encodeURIComponent(baseUrl)}`,
  );
}

// ─── Polling helpers ───────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Poll GET /campaigns/{id} until the state is one of `targetStates`.
 * Calls `onTick` on every poll so the UI can stay reactive.
 * Throws if timeout is exceeded or state becomes "failed".
 */
export async function pollCampaignState(
  campaignId: string,
  targetStates: CampaignState[],
  onTick?: (campaign: CampaignRead) => void,
): Promise<CampaignRead> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const campaign = await getCampaign(campaignId);
    onTick?.(campaign);

    if (campaign.state === "failed") {
      throw new ApiError(500, `Campaign failed (id: ${campaignId})`);
    }
    if (targetStates.includes(campaign.state)) {
      return campaign;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new ApiError(408, "Timed out waiting for pipeline to complete");
}

/**
 * Poll GET /campaigns/{id}/render until status is "completed" or "failed".
 * Calls `onTick` on every poll.
 */
export async function pollRenderStatus(
  campaignId: string,
  onTick?: (task: RenderTaskRead) => void,
): Promise<RenderTaskRead> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const task = await getRenderStatus(campaignId);
    onTick?.(task);

    if (task.status === "failed") {
      throw new ApiError(500, task.error_message ?? "Render failed");
    }
    if (task.status === "completed") {
      return task;
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new ApiError(408, "Timed out waiting for video render");
}

// ─── Utilities ─────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Map a backend StoryboardScene to the frontend Scene shape used by demo.ts.
 */
export function mapScene(s: StoryboardScene, index: number) {
  // Fallback gradient palette — cycles through 4 options
  const GRADIENTS = [
    "from-sky-400 via-cyan-400 to-blue-500",
    "from-violet-400 via-indigo-400 to-brand-500",
    "from-emerald-400 via-teal-400 to-cyan-500",
    "from-rose-400 via-pink-400 to-fuchsia-500",
  ];

  return {
    id: s.id ?? `scene-${index}`,
    order: s.order ?? index,
    visualPrompt: s.visual_prompt ?? "",
    durationSec: s.duration_sec ?? 3,
    narration: s.narration ?? { "en-US": "" },
    gradient: GRADIENTS[index % GRADIENTS.length],
  };
}

/**
 * Map a backend ProductRead brand_book to the BrandBook shape used by demo.ts.
 */
export function mapBrandBook(product: ProductRead) {
  const bb = product.brand_book ?? {};
  return {
    productName: product.product_name ?? "Product",
    tagline: (bb.tagline as string) ?? "",
    tone: (bb.tone as string) ?? (bb.brand_voice as string) ?? "",
    audience: (bb.audience as string) ?? "",
    colors: (bb.color_palette as string[]) ?? ["#0ea5e9", "#6366f1", "#10b981", "#f43f5e"],
  };
}
