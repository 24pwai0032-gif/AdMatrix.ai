"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY || "";

function apiHeaders(): HeadersInit {
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (API_KEY) headers["X-API-Key"] = API_KEY;
  return headers;
}

async function parseError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body.detail?.message || body.detail || `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

const STATE_ORDER = [
  "draft",
  "ingesting",
  "scripting",
  "awaiting_approval",
  "approved",
  "rendering",
  "compliance_check",
  "completed",
  "failed",
  "cancelled",
] as const;

type CampaignState = (typeof STATE_ORDER)[number];

interface Scene {
  scene_id: string;
  order: number;
  narration: string;
  visual_prompt: string;
  duration_sec: number;
  panel_image_url?: string;
}

interface Storyboard {
  id: string;
  locale: string;
  scenes: Scene[];
  narrative: string | null;
  panel_images: string[];
  hitl_status: string;
}

interface Campaign {
  id: string;
  state: CampaignState;
  primary_locale: string;
  target_locales: string[];
  revision_count: number;
  script_draft: { scenes?: Scene[] };
}

interface Metrics {
  total_cost_usd: number;
  budget_threshold_usd: number;
  by_model: Record<string, { cost_usd: number; calls: number }>;
}

const DEMO_CAMPAIGN: Campaign = {
  id: "demo-campaign-001",
  state: "awaiting_approval",
  primary_locale: "en-US",
  target_locales: ["en-US", "zh-CN", "ja-JP"],
  revision_count: 0,
  script_draft: {
    scenes: [
      { scene_id: "s1", order: 0, narration: "Discover smart hydration.", visual_prompt: "Product hero shot", duration_sec: 3 },
      { scene_id: "s2", order: 1, narration: "Track every sip.", visual_prompt: "App interface overlay", duration_sec: 3 },
      { scene_id: "s3", order: 2, narration: "24-hour temperature lock.", visual_prompt: "Ice cubes close-up", duration_sec: 3 },
      { scene_id: "s4", order: 3, narration: "Shop now — limited offer.", visual_prompt: "CTA end card", duration_sec: 3 },
    ],
  },
};

const DEMO_STORYBOARD: Storyboard = {
  id: "demo-sb-001",
  locale: "en-US",
  scenes: DEMO_CAMPAIGN.script_draft.scenes!,
  narrative: "Discover smart hydration. Track every sip. 24-hour temperature lock. Shop now.",
  panel_images: ["/panel-1.jpg", "/panel-2.jpg", "/panel-3.jpg", "/panel-4.jpg"],
  hitl_status: "pending",
};

export default function DashboardPage() {
  const [productUrl, setProductUrl] = useState("");
  const [campaign, setCampaign] = useState<Campaign | null>(DEMO_MODE ? DEMO_CAMPAIGN : null);
  const [storyboard, setStoryboard] = useState<Storyboard | null>(DEMO_MODE ? DEMO_STORYBOARD : null);
  const [selectedLocale, setSelectedLocale] = useState("en-US");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [editedScenes, setEditedScenes] = useState<Scene[]>([]);
  const complianceTriggered = useRef(false);

  const fetchCampaign = useCallback(async (id: string) => {
    if (DEMO_MODE) return;
    const res = await fetch(`${API_BASE}/api/v1/campaigns/${id}`, { headers: apiHeaders() });
    if (!res.ok) throw new Error(await parseError(res));
    const data = await res.json();
    setCampaign(data);
  }, []);

  const fetchRenderStatus = useCallback(async (id: string) => {
    if (DEMO_MODE) return;
    try {
      const res = await fetch(`${API_BASE}/api/v1/campaigns/${id}/render`, { headers: apiHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      if (data.status === "completed") {
        const urlRes = await fetch(
          `${API_BASE}/api/v1/campaigns/${id}/video-url?base_url=${encodeURIComponent(API_BASE)}`,
          { headers: apiHeaders() },
        );
        if (urlRes.ok) {
          const { video_url } = await urlRes.json();
          setVideoUrl(video_url);
        }
        if (!complianceTriggered.current) {
          complianceTriggered.current = true;
          const complianceRes = await fetch(`${API_BASE}/api/v1/campaigns/${id}/compliance`, {
            method: "POST",
            headers: apiHeaders(),
          });
          if (complianceRes.ok) {
            const campRes = await fetch(`${API_BASE}/api/v1/campaigns/${id}`, { headers: apiHeaders() });
            if (campRes.ok) setCampaign(await campRes.json());
          }
        }
      }
    } catch {
      /* render may not be started yet */
    }
  }, []);

  const fetchStoryboard = useCallback(async (id: string) => {
    if (DEMO_MODE) return;
    try {
      const res = await fetch(`${API_BASE}/api/v1/campaigns/${id}/storyboard`, { headers: apiHeaders() });
      if (res.ok) {
        const data = await res.json();
        setStoryboard(data);
        setEditedScenes(data.scenes || []);
      }
    } catch {
      /* storyboard may not exist yet */
    }
  }, []);

  const fetchMetrics = useCallback(async (id?: string) => {
    if (DEMO_MODE) {
      setMetrics({ total_cost_usd: 2.45, budget_threshold_usd: 10, by_model: { "qwen3.6-plus": { cost_usd: 1.2, calls: 8 } } });
      return;
    }
    const url = id ? `${API_BASE}/api/v1/metrics?campaign_id=${id}` : `${API_BASE}/api/v1/metrics`;
    const res = await fetch(url, { headers: apiHeaders() });
    if (res.ok) setMetrics(await res.json());
  }, []);

  useEffect(() => {
    if (!campaign?.id || DEMO_MODE) return;
    const interval = setInterval(() => {
      fetchCampaign(campaign.id);
      fetchStoryboard(campaign.id);
      fetchMetrics(campaign.id);
      if (campaign.state === "rendering" || campaign.state === "approved") {
        fetchRenderStatus(campaign.id);
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [campaign?.id, campaign?.state, fetchCampaign, fetchStoryboard, fetchMetrics, fetchRenderStatus]);

  useEffect(() => {
    if (storyboard?.scenes) setEditedScenes(storyboard.scenes);
  }, [storyboard]);

  async function handleIngest() {
    setLoading(true);
    setError(null);
    try {
      if (DEMO_MODE) {
        setCampaign(DEMO_CAMPAIGN);
        setStoryboard(DEMO_STORYBOARD);
        setEditedScenes(DEMO_STORYBOARD.scenes);
        await fetchMetrics();
        return;
      }

      const ingestRes = await fetch(`${API_BASE}/api/v1/ingest`, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ source_url: productUrl }),
      });
      if (!ingestRes.ok) throw new Error(await parseError(ingestRes));
      const product = await ingestRes.json();

      const campRes = await fetch(`${API_BASE}/api/v1/campaigns`, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({
          product_id: product.id,
          target_locales: ["en-US", "zh-CN", "ja-JP"],
        }),
      });
      if (!campRes.ok) throw new Error(await parseError(campRes));
      const camp = await campRes.json();
      setCampaign(camp);

      const scriptRes = await fetch(`${API_BASE}/api/v1/campaigns/${camp.id}/script`, {
        method: "POST",
        headers: apiHeaders(),
      });
      if (!scriptRes.ok) throw new Error(await parseError(scriptRes));
      await fetchCampaign(camp.id);
      await fetchStoryboard(camp.id);
      await fetchMetrics(camp.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function handleApproval(action: "APPROVE" | "REJECT") {
    if (!campaign) return;
    setLoading(true);
    try {
      if (DEMO_MODE) {
        if (action === "APPROVE") {
          setCampaign({ ...campaign, state: "approved" });
          setVideoUrl("/demo-video.mp4");
        }
        return;
      }
      const res = await fetch(`${API_BASE}/api/v1/campaigns/${campaign.id}/approve`, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error(await parseError(res));
      if (action === "APPROVE") {
        const renderRes = await fetch(`${API_BASE}/api/v1/campaigns/${campaign.id}/render`, {
          method: "POST",
          headers: apiHeaders(),
        });
        if (!renderRes.ok) throw new Error(await parseError(renderRes));
      }
      await fetchCampaign(campaign.id);
      await fetchStoryboard(campaign.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  function updateSceneNarration(index: number, narration: string) {
    setEditedScenes((prev) => prev.map((s, i) => (i === index ? { ...s, narration } : s)));
  }

  const currentState = campaign?.state ?? "draft";
  const stateIndex = STATE_ORDER.indexOf(currentState);

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>AdMatrix.ai</h1>
        <p style={styles.subtitle}>AI-Powered Multilingual Video Ad Production</p>
        {DEMO_MODE && <span style={styles.demoBadge}>DEMO MODE</span>}
      </header>

      {/* Ingest */}
      <section style={styles.card}>
        <h2 style={styles.cardTitle}>Product Ingest</h2>
        <div style={styles.row}>
          <input
            type="url"
            placeholder="https://example.com/product"
            value={productUrl}
            onChange={(e) => setProductUrl(e.target.value)}
            style={styles.input}
          />
          <button onClick={handleIngest} disabled={loading || (!productUrl && !DEMO_MODE)} style={styles.primaryBtn}>
            {loading ? "Processing…" : "Ingest & Generate"}
          </button>
        </div>
        {error && <p style={styles.error}>{error}</p>}
      </section>

      {/* Status Timeline */}
      {campaign && (
        <section style={styles.card}>
          <h2 style={styles.cardTitle}>Campaign Status</h2>
          <div style={styles.timeline}>
            {STATE_ORDER.slice(0, 8).map((state, i) => (
              <div key={state} style={styles.timelineStep}>
                <div
                  style={{
                    ...styles.timelineDot,
                    background: i <= stateIndex ? "#e94560" : "#2a2a4a",
                    boxShadow: i === stateIndex ? "0 0 12px #e94560" : "none",
                  }}
                />
                <span style={{ ...styles.timelineLabel, opacity: i <= stateIndex ? 1 : 0.4 }}>
                  {state.replace(/_/g, " ")}
                </span>
              </div>
            ))}
          </div>
          <p style={styles.meta}>
            Campaign: {campaign.id.slice(0, 8)}… · Revision {campaign.revision_count}
          </p>
        </section>
      )}

      {/* Metrics Widget */}
      {metrics && (
        <section style={styles.card}>
          <h2 style={styles.cardTitle}>Token Usage</h2>
          <div style={styles.metricsRow}>
            <div style={styles.metric}>
              <span style={styles.metricValue}>${metrics.total_cost_usd.toFixed(2)}</span>
              <span style={styles.metricLabel}>Total Spend</span>
            </div>
            <div style={styles.metric}>
              <span style={styles.metricValue}>${metrics.budget_threshold_usd}</span>
              <span style={styles.metricLabel}>Budget Cap</span>
            </div>
            <div style={styles.metric}>
              <span style={styles.metricValue}>
                {((metrics.total_cost_usd / metrics.budget_threshold_usd) * 100).toFixed(0)}%
              </span>
              <span style={styles.metricLabel}>Utilization</span>
            </div>
          </div>
        </section>
      )}

      {/* HITL Storyboard Approval */}
      {storyboard && campaign?.state === "awaiting_approval" && (
        <section style={styles.card}>
          <h2 style={styles.cardTitle}>Storyboard Approval</h2>
          <div style={styles.panelGrid}>
            {(storyboard.panel_images.length ? storyboard.panel_images : editedScenes).slice(0, 4).map((panel, i) => (
              <div key={i} style={styles.panel}>
                <div style={styles.panelImage}>
                  {typeof panel === "string" ? `Panel ${i + 1}` : `Scene ${i + 1}`}
                </div>
                <textarea
                  value={editedScenes[i]?.narration || ""}
                  onChange={(e) => updateSceneNarration(i, e.target.value)}
                  style={styles.narrativeEditor}
                  rows={3}
                />
              </div>
            ))}
          </div>
          <p style={styles.narrative}>{storyboard.narrative}</p>
          <div style={styles.row}>
            <button onClick={() => handleApproval("APPROVE")} disabled={loading} style={styles.approveBtn}>
              Approve & Render
            </button>
            <button onClick={() => handleApproval("REJECT")} disabled={loading} style={styles.rejectBtn}>
              Request Revision
            </button>
          </div>
        </section>
      )}

      {/* Video Player + Locale Selector */}
      {(campaign?.state === "rendering" || campaign?.state === "compliance_check" || campaign?.state === "completed" || campaign?.state === "failed" || campaign?.state === "approved" || videoUrl) && (
        <section style={styles.card}>
          <h2 style={styles.cardTitle}>Video Output</h2>
          <div style={styles.row}>
            <label style={styles.localeLabel}>Language:</label>
            <select
              value={selectedLocale}
              onChange={(e) => setSelectedLocale(e.target.value)}
              style={styles.select}
            >
              {(campaign?.target_locales || ["en-US"]).map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </div>
          <div style={styles.videoContainer}>
            {videoUrl ? (
              <video src={videoUrl} controls style={styles.video} />
            ) : (
              <div style={styles.videoPlaceholder}>
                <p>Rendering 9:16 video for {selectedLocale}…</p>
                <div style={styles.spinner} />
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 50%, #16213e 100%)",
    color: "#e8e8f0",
    padding: "2rem",
    fontFamily: "'Inter', system-ui, sans-serif",
  },
  header: { textAlign: "center", marginBottom: "2rem", position: "relative" },
  title: { fontSize: "2.5rem", fontWeight: 700, margin: 0, background: "linear-gradient(90deg, #e94560, #ff6b8a)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" },
  subtitle: { color: "#8888aa", marginTop: "0.5rem" },
  demoBadge: { position: "absolute", top: 0, right: 0, background: "#e94560", padding: "4px 12px", borderRadius: 12, fontSize: 12, fontWeight: 600 },
  card: { background: "rgba(255,255,255,0.04)", borderRadius: 16, padding: "1.5rem", marginBottom: "1.5rem", border: "1px solid rgba(255,255,255,0.08)" },
  cardTitle: { fontSize: "1.1rem", fontWeight: 600, marginBottom: "1rem", color: "#ccc" },
  row: { display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" },
  input: { flex: 1, minWidth: 280, padding: "0.75rem 1rem", borderRadius: 10, border: "1px solid #333", background: "#12121f", color: "#fff", fontSize: 14 },
  primaryBtn: { padding: "0.75rem 1.5rem", borderRadius: 10, border: "none", background: "#e94560", color: "#fff", fontWeight: 600, cursor: "pointer" },
  approveBtn: { padding: "0.75rem 1.5rem", borderRadius: 10, border: "none", background: "#22c55e", color: "#fff", fontWeight: 600, cursor: "pointer" },
  rejectBtn: { padding: "0.75rem 1.5rem", borderRadius: 10, border: "none", background: "transparent", color: "#e94560", fontWeight: 600, cursor: "pointer", borderWidth: 1, borderStyle: "solid", borderColor: "#e94560" },
  error: { color: "#ef4444", marginTop: "0.5rem" },
  timeline: { display: "flex", gap: "0.5rem", overflowX: "auto", paddingBottom: "0.5rem" },
  timelineStep: { display: "flex", flexDirection: "column", alignItems: "center", minWidth: 80 },
  timelineDot: { width: 12, height: 12, borderRadius: "50%", marginBottom: 6 },
  timelineLabel: { fontSize: 10, textTransform: "capitalize", textAlign: "center" },
  meta: { fontSize: 12, color: "#666", marginTop: "0.75rem" },
  metricsRow: { display: "flex", gap: "2rem" },
  metric: { display: "flex", flexDirection: "column" },
  metricValue: { fontSize: "1.5rem", fontWeight: 700, color: "#e94560" },
  metricLabel: { fontSize: 12, color: "#888" },
  panelGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" },
  panel: { display: "flex", flexDirection: "column", gap: "0.5rem" },
  panelImage: { aspectRatio: "9/16", background: "#1a1a2e", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", color: "#555", border: "1px solid #333" },
  narrativeEditor: { width: "100%", padding: "0.5rem", borderRadius: 8, border: "1px solid #333", background: "#12121f", color: "#fff", fontSize: 13, resize: "vertical" },
  narrative: { fontSize: 14, color: "#aaa", margin: "1rem 0" },
  localeLabel: { fontSize: 14, color: "#aaa" },
  select: { padding: "0.5rem 1rem", borderRadius: 8, border: "1px solid #333", background: "#12121f", color: "#fff" },
  videoContainer: { marginTop: "1rem", borderRadius: 16, overflow: "hidden", background: "#000" },
  video: { width: "100%", maxWidth: 360, margin: "0 auto", display: "block" },
  videoPlaceholder: { padding: "4rem", textAlign: "center", color: "#666" },
  spinner: { width: 40, height: 40, border: "3px solid #333", borderTopColor: "#e94560", borderRadius: "50%", margin: "1rem auto", animation: "spin 1s linear infinite" },
};
