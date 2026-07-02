"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Cpu,
  Film,
  Gauge,
  Globe,
  Link2,
  Loader2,
  Palette,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
  Wand2,
  X,
} from "lucide-react";
import {
  BUDGET_USD,
  COST_LEDGER,
  DEMO_PRODUCT,
  getDemoProduct,
  LOCALES,
  PIPELINE,
  SAMPLE_URLS,
  type Scene,
  type StageKey,
} from "@/lib/demo";
import {
  ApiError,
  approveCampaign,
  createCampaign,
  getStoryboard,
  getVideoUrl,
  ingestProduct,
  mapBrandBook,
  mapScene,
  pollCampaignState,
  pollRenderStatus,
  runScript,
  startRender,
} from "@/lib/api";

/** true  → browser simulation (no backend needed)
 *  false → real API calls to http://localhost:8000 */
const IS_DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

type Phase = "idle" | "running" | "awaiting_approval" | "done" | "error";

// How far costs have accrued, keyed by the stage we've reached.
const COST_REVEAL: Partial<Record<StageKey, number>> = {
  transcreation: 1,
  storyboarding: 2,
  video_rendering: 3,
  lip_syncing: 4,
  compliance_check: 4,
};

export default function DashboardPage() {
  const [url, setUrl] = useState("");
  const [locales, setLocales] = useState<string[]>(["en-US", "zh-CN", "ja-JP"]);
  const [current, setCurrent] = useState(-1); // index into PIPELINE
  const [phase, setPhase] = useState<Phase>("idle");
  const [approved, setApproved] = useState(false);
  const [revision, setRevision] = useState(0);
  const [scenes, setScenes] = useState<Scene[]>(DEMO_PRODUCT.scenes);
  const [brand, setBrand] = useState(DEMO_PRODUCT.brand);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  // Holds the live campaign ID when running in live mode
  const campaignIdRef = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const approvalIndex = PIPELINE.findIndex((s) => s.key === "awaiting_approval");
  const storyboardIndex = PIPELINE.findIndex((s) => s.key === "storyboarding");

  // ---- Pipeline simulation engine -----------------------------------------
  useEffect(() => {
    if (current < 0 || phase === "done") return;
    const stage = PIPELINE[current];

    if (stage.key === "awaiting_approval" && !approved) {
      setPhase("awaiting_approval");
      return;
    }
    setPhase("running");

    const advance = () => {
      if (current >= PIPELINE.length - 1) {
        setPhase("done");
      } else {
        setCurrent((c) => c + 1);
      }
    };

    const delay = stage.key === "awaiting_approval" ? 250 : stage.duration;
    timer.current = setTimeout(advance, delay);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [current, approved, phase]);

  // ---- Helpers ----------------------------------------------------------------
  const goToStage = (key: StageKey) => {
    const idx = PIPELINE.findIndex((s) => s.key === key);
    if (idx >= 0) setCurrent(idx);
  };

  const failWith = (msg: string) => {
    setPhase("error");
    setErrorMsg(msg);
  };

  // ---- Demo simulation start (unchanged) ------------------------------------
  const startDemo = () => {
    const product = getDemoProduct(url);
    setScenes(product.scenes);
    setBrand(product.brand);
    setApproved(false);
    setRevision(0);
    setPhase("running");
    setCurrent(0);
  };

  // ---- Live mode start (real API calls) -------------------------------------
  const startLive = async () => {
    setErrorMsg(null);
    setVideoUrl(null);
    setApproved(false);
    setRevision(0);
    setPhase("running");
    goToStage("scraping");

    try {
      // 1. Ingest — scrape product page
      const product = await ingestProduct(url || "https://demo.admatrix.ai/products/hydro-smart-bottle");
      setBrand(mapBrandBook(product));

      // 2. Create campaign
      const primaryLocale = locales[0] ?? "en-US";
      const campaign = await createCampaign(
        product.id,
        locales,
        primaryLocale,
      );
      campaignIdRef.current = campaign.id;

      // 3. Transcreation + storyboarding (script workflow)
      goToStage("transcreation");
      await runScript(campaign.id);

      goToStage("storyboarding");
      // Poll until AWAITING_APPROVAL
      await pollCampaignState(campaign.id, ["awaiting_approval"], (c) => {
        if (c.state === "scripting") goToStage("transcreation");
      });

      // Fetch the real storyboard and map to frontend Scene[]
      const storyboard = await getStoryboard(campaign.id);
      const mappedScenes: Scene[] = storyboard.scenes.map((s, i) => mapScene(s, i));
      setScenes(mappedScenes);

      // 4. HITL checkpoint — pause for human approval
      goToStage("awaiting_approval");
      setPhase("awaiting_approval");
      // Execution pauses here; the approve/reject buttons call approveLive / reviseLive

    } catch (err) {
      const msg = err instanceof ApiError ? err.detail : String(err);
      failWith(msg);
    }
  };

  const start = () => {
    if (IS_DEMO_MODE) {
      startDemo();
    } else {
      startLive();
    }
  };

  // ---- Live-mode approval/rejection ----------------------------------------
  const continueLiveAfterApproval = useCallback(async () => {
    const cid = campaignIdRef.current;
    if (!cid) return;
    try {
      // Approve the storyboard
      await approveCampaign(cid, "APPROVE");

      // Audio + video + lip-sync via render pipeline
      goToStage("audio_generating");
      setPhase("running");
      await startRender(cid);

      goToStage("video_rendering");
      // Poll render status
      await pollRenderStatus(cid, (task) => {
        if (task.status === "processing") goToStage("lip_syncing");
      });

      goToStage("compliance_check");
      // Compliance runs inside the backend render pipeline; just brief visual hold
      await new Promise((r) => setTimeout(r, 1200));

      // Fetch the signed video URL
      try {
        const urlResp = await getVideoUrl(cid);
        setVideoUrl(urlResp.video_url);
      } catch {
        // Video URL optional — placeholder player still works
        setVideoUrl(null);
      }

      setPhase("done");
      setCurrent(PIPELINE.length - 1);
    } catch (err) {
      const msg = err instanceof ApiError ? err.detail : String(err);
      failWith(msg);
    }
  }, []);

  const reviseLive = useCallback(async () => {
    const cid = campaignIdRef.current;
    if (!cid) return;
    try {
      await approveCampaign(cid, "REJECT", "Requested revision");
      setRevision((r) => r + 1);
      setApproved(false);
      goToStage("storyboarding");
      setPhase("running");

      // Re-run script workflow
      await runScript(cid);
      await pollCampaignState(cid, ["awaiting_approval"]);
      const storyboard = await getStoryboard(cid);
      const mappedScenes: Scene[] = storyboard.scenes.map((s, i) => mapScene(s, i));
      setScenes(mappedScenes);

      goToStage("awaiting_approval");
      setPhase("awaiting_approval");
    } catch (err) {
      const msg = err instanceof ApiError ? err.detail : String(err);
      failWith(msg);
    }
  }, []);

  // ---- Approval handlers (demo vs live) ------------------------------------
  const approve = useCallback(() => {
    if (IS_DEMO_MODE) {
      setApproved(true);
      setCurrent((c) => c + 1);
    } else {
      continueLiveAfterApproval();
    }
  }, [continueLiveAfterApproval]);

  const requestRevision = useCallback(() => {
    if (IS_DEMO_MODE) {
      setRevision((r) => r + 1);
      setApproved(false);
      setCurrent(storyboardIndex);
    } else {
      reviseLive();
    }
  }, [storyboardIndex, reviseLive]);

  const reset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setCurrent(-1);
    setPhase("idle");
    setApproved(false);
    setRevision(0);
    setErrorMsg(null);
    setVideoUrl(null);
    campaignIdRef.current = null;
  }, []);

  const updateNarration = (idx: number, locale: string, text: string) =>
    setScenes((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, narration: { ...s.narration, [locale]: text } } : s)),
    );

  const toggleLocale = (code: string) =>
    setLocales((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );

  // ---- Derived view state --------------------------------------------------
  const reachedKey: StageKey | undefined = current >= 0 ? PIPELINE[current].key : undefined;
  const revealCount = reachedKey ? COST_REVEAL[reachedKey] ?? 0 : 0;
  const ledger = phase === "done" ? COST_LEDGER : COST_LEDGER.slice(0, revealCount);
  const totalCost = ledger.reduce((sum, m) => sum + m.cost, 0);
  const utilization = Math.min(100, (totalCost / BUDGET_USD) * 100);

  const showStoryboard = phase === "awaiting_approval";
  const showVideo = phase === "done";
  const activeLocales = LOCALES.filter((l) => locales.includes(l.code));

  return (
    <div className="min-h-screen bg-grid">
      <NavBar onReset={reset} canReset={current >= 0} isLive={!IS_DEMO_MODE} />

      <main className="mx-auto max-w-5xl px-4 pb-24 pt-8 sm:px-6">
        <Hero />

        {errorMsg && (
          <ErrorBanner message={errorMsg} onDismiss={() => { setErrorMsg(null); reset(); }} />
        )}

        <IngestCard
          url={url}
          setUrl={setUrl}
          locales={locales}
          toggleLocale={toggleLocale}
          onStart={start}
          running={current >= 0 && phase !== "done" && phase !== "error"}
        />

        {current >= 0 && phase !== "error" && (
          <>
            <Stepper current={current} phase={phase} revision={revision} />
            <BrandBookCard brand={brand} />
          </>
        )}

        {showStoryboard && (
          <StoryboardCard
            scenes={scenes}
            locales={activeLocales}
            onApprove={approve}
            onRevise={requestRevision}
            revision={revision}
            onEdit={updateNarration}
          />
        )}

        {current >= 0 && phase !== "error" && (
          <MetricsCard ledger={ledger} totalCost={totalCost} utilization={utilization} />
        )}

        {showVideo && (
          <VideoCard
            scenes={scenes}
            locales={activeLocales}
            liveVideoUrl={videoUrl}
          />
        )}
      </main>
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* Layout pieces                                                            */
/* ----------------------------------------------------------------------- */

function NavBar({
  onReset,
  canReset,
  isLive,
}: {
  onReset: () => void;
  canReset: boolean;
  isLive: boolean;
}) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-violet-500 text-white shadow-ring">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <p className="text-[15px] font-bold tracking-tight text-slate-900">AdMatrix.ai</p>
            <p className="text-[11px] text-slate-500">Localized video ads, automatically</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-600 sm:inline-flex">
            <Cpu className="h-3.5 w-3.5 text-brand-500" /> Powered by Qwen Cloud
          </span>
          {isLive ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 ring-1 ring-brand-600/20">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500" /> Live
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-600/20">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Demo
            </span>
          )}
          {canReset && (
            <button
              onClick={onReset}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Reset
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div className="mb-5 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 animate-fade-up">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
      <div className="flex-1">
        <p className="text-sm font-semibold text-red-800">Pipeline error</p>
        <p className="mt-0.5 text-xs text-red-600">{message}</p>
      </div>
      <button
        onClick={onDismiss}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-red-400 transition hover:bg-red-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function Hero() {
  return (
    <div className="mb-8 animate-fade-up text-center">
      <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700">
        <Wand2 className="h-3.5 w-3.5" /> Multi-agent creative pipeline
      </span>
      <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
        Turn a product URL into a{" "}
        <span className="bg-gradient-to-r from-brand-600 to-violet-500 bg-clip-text text-transparent">
          localized video ad
        </span>
      </h1>
      <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-slate-500">
        Paste a link. Agents scrape the page, transcreate your script per dialect, storyboard the
        scenes, and render a lip-synced 9:16 ad — you just approve the storyboard.
      </p>
    </div>
  );
}

function Card({
  title,
  icon,
  children,
  accent,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  accent?: string;
}) {
  return (
    <section className="mb-5 animate-fade-up rounded-2xl border border-slate-200 bg-white p-5 shadow-card sm:p-6">
      <div className="mb-4 flex items-center gap-2.5">
        <span className={`grid h-8 w-8 place-items-center rounded-lg ${accent ?? "bg-brand-50 text-brand-600"}`}>
          {icon}
        </span>
        <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function IngestCard({
  url,
  setUrl,
  locales,
  toggleLocale,
  onStart,
  running,
}: {
  url: string;
  setUrl: (v: string) => void;
  locales: string[];
  toggleLocale: (c: string) => void;
  onStart: () => void;
  running: boolean;
}) {
  return (
    <Card title="Product ingest" icon={<Link2 className="h-4.5 w-4.5" />}>
      <div className="flex flex-col gap-2.5 sm:flex-row">
        <div className="relative flex-1">
          <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://store.example.com/your-product"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-9 pr-3 text-sm text-slate-900 outline-none transition focus:border-brand-400 focus:bg-white focus:ring-4 focus:ring-brand-100"
          />
        </div>
        <button
          onClick={onStart}
          disabled={running}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand-600 to-violet-500 px-5 py-3 text-sm font-semibold text-white shadow-ring transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {running ? "Generating…" : "Generate ad"}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-slate-400">Try:</span>
        {SAMPLE_URLS.map((s) => (
          <button
            key={s}
            onClick={() => setUrl(s)}
            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 transition hover:border-brand-300 hover:text-brand-600"
          >
            {s.replace("https://", "")}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <p className="mb-2 text-xs font-medium text-slate-500">Target locales</p>
        <div className="flex flex-wrap gap-2">
          {LOCALES.map((l) => {
            const on = locales.includes(l.code);
            return (
              <button
                key={l.code}
                onClick={() => toggleLocale(l.code)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  on
                    ? "border-brand-300 bg-brand-50 text-brand-700"
                    : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                }`}
              >
                <span>{l.flag}</span>
                {l.label}
                {on && <Check className="h-3.5 w-3.5" />}
              </button>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

function Stepper({
  current,
  phase,
  revision,
}: {
  current: number;
  phase: Phase;
  revision: number;
}) {
  return (
    <Card
      title="Pipeline"
      icon={<Gauge className="h-4.5 w-4.5" />}
      accent="bg-violet-50 text-violet-600"
    >
      <div className="flex gap-2 overflow-x-auto pb-1">
        {PIPELINE.map((stage, i) => {
          const done = phase === "done" || i < current;
          const active = i === current && phase !== "done";
          return (
            <div key={stage.key} className="flex min-w-[112px] flex-1 flex-col items-center">
              <div className="flex w-full items-center">
                <span
                  className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold transition ${
                    done
                      ? "bg-emerald-500 text-white"
                      : active
                        ? "animate-pulse-ring bg-brand-600 text-white"
                        : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {done ? <Check className="h-4 w-4" /> : i + 1}
                </span>
                {i < PIPELINE.length - 1 && (
                  <span
                    className={`mx-1 h-0.5 flex-1 rounded ${i < current || phase === "done" ? "bg-emerald-400" : "bg-slate-200"}`}
                  />
                )}
              </div>
              <p
                className={`mt-2 text-center text-[11px] font-semibold ${
                  active ? "text-brand-700" : done ? "text-slate-700" : "text-slate-400"
                }`}
              >
                {stage.label}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
        <div className="flex items-center gap-2.5">
          {phase === "done" ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          ) : phase === "awaiting_approval" ? (
            <Pause className="h-5 w-5 text-amber-500" />
          ) : (
            <Loader2 className="h-5 w-5 animate-spin text-brand-500" />
          )}
          <p className="text-sm text-slate-600">
            {phase === "done"
              ? "Ad rendered & compliance-passed."
              : current >= 0
                ? PIPELINE[current].detail
                : ""}
          </p>
        </div>
        {revision > 0 && (
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
            Revision {revision}
          </span>
        )}
      </div>
    </Card>
  );
}

function BrandBookCard({ brand }: { brand: typeof DEMO_PRODUCT.brand }) {
  const items = [
    { icon: <Sparkles className="h-4 w-4" />, label: "Product", value: brand.productName },
    { icon: <Wand2 className="h-4 w-4" />, label: "Tone", value: brand.tone },
    { icon: <Users className="h-4 w-4" />, label: "Audience", value: brand.audience },
  ];
  return (
    <Card
      title="Extracted brand book"
      icon={<Palette className="h-4.5 w-4.5" />}
      accent="bg-rose-50 text-rose-500"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {items.map((it) => (
          <div key={it.label} className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <div className="mb-1 flex items-center gap-1.5 text-slate-400">
              {it.icon}
              <span className="text-[11px] font-semibold uppercase tracking-wide">{it.label}</span>
            </div>
            <p className="text-sm font-medium text-slate-800">{it.value}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <span className="text-xs font-medium text-slate-500">Palette</span>
        {brand.colors.map((c) => (
          <span
            key={c}
            className="h-6 w-6 rounded-md ring-1 ring-black/5"
            style={{ backgroundColor: c }}
            title={c}
          />
        ))}
      </div>
    </Card>
  );
}

function StoryboardCard({
  scenes,
  locales,
  onApprove,
  onRevise,
  revision,
  onEdit,
}: {
  scenes: Scene[];
  locales: { code: string; label: string; flag: string }[];
  onApprove: () => void;
  onRevise: () => void;
  revision: number;
  onEdit: (idx: number, locale: string, text: string) => void;
}) {
  const editLocale = locales[0]?.code ?? "en-US";
  return (
    <Card
      title="Storyboard approval"
      icon={<Film className="h-4.5 w-4.5" />}
      accent="bg-amber-50 text-amber-600"
    >
      <p className="mb-4 text-sm text-slate-500">
        Human-in-the-loop checkpoint — review the {scenes.length} generated panels and tweak any
        narration before rendering.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {scenes.map((s, i) => (
          <div key={s.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className={`relative aspect-[9/16] bg-gradient-to-br ${s.gradient}`}>
              <span className="absolute left-2 top-2 rounded-md bg-black/25 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur">
                Scene {i + 1}
              </span>
              <span className="absolute bottom-2 right-2 rounded-md bg-black/25 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
                {s.durationSec}s
              </span>
              <div className="absolute inset-0 flex items-end p-3">
                <p className="text-[11px] font-medium leading-snug text-white/90 drop-shadow">
                  {s.visualPrompt}
                </p>
              </div>
            </div>
            <div className="p-2">
              <textarea
                value={s.narration[editLocale] ?? ""}
                onChange={(e) => onEdit(i, editLocale, e.target.value)}
                rows={2}
                className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700 outline-none transition focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100"
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          onClick={onApprove}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-600"
        >
          <Check className="h-4 w-4" /> Approve & render
        </button>
        <button
          onClick={onRevise}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
        >
          <RefreshCw className="h-4 w-4" /> Request revision
        </button>
        <span className="text-xs text-slate-400">
          Editing narration for {locales[0]?.flag} {editLocale}
          {revision > 0 ? ` · revision ${revision}` : ""}
        </span>
      </div>
    </Card>
  );
}

function MetricsCard({
  ledger,
  totalCost,
  utilization,
}: {
  ledger: { model: string; calls: number; cost: number }[];
  totalCost: number;
  utilization: number;
}) {
  const over = utilization >= 80;
  return (
    <Card
      title="Token usage & budget"
      icon={<Gauge className="h-4.5 w-4.5" />}
      accent="bg-emerald-50 text-emerald-600"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Total spend" value={`$${totalCost.toFixed(2)}`} />
        <Stat label="Budget cap" value={`$${BUDGET_USD.toFixed(2)}`} />
        <Stat
          label="Utilization"
          value={`${utilization.toFixed(0)}%`}
          tone={over ? "warn" : "ok"}
        />
      </div>

      <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full transition-all duration-700 ${over ? "bg-amber-500" : "bg-gradient-to-r from-brand-500 to-emerald-500"}`}
          style={{ width: `${Math.max(2, utilization)}%` }}
        />
      </div>

      <div className="mt-4 space-y-1.5">
        {ledger.length === 0 && (
          <p className="text-xs text-slate-400">Metering will populate as agents run…</p>
        )}
        {ledger.map((m) => (
          <div
            key={m.model}
            className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs"
          >
            <span className="flex items-center gap-2 font-medium text-slate-700">
              <Cpu className="h-3.5 w-3.5 text-brand-500" /> {m.model}
            </span>
            <span className="text-slate-400">
              {m.calls} calls · <span className="font-semibold text-slate-700">${m.cost.toFixed(2)}</span>
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p
        className={`mt-0.5 text-2xl font-bold ${
          tone === "warn" ? "text-amber-600" : tone === "ok" ? "text-emerald-600" : "text-slate-900"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function VideoCard({
  scenes,
  locales,
  liveVideoUrl,
}: {
  scenes: Scene[];
  locales: { code: string; label: string; flag: string }[];
  liveVideoUrl?: string | null;
}) {
  const [locale, setLocale] = useState(locales[0]?.code ?? "en-US");
  const [playing, setPlaying] = useState(true);
  const [sceneIdx, setSceneIdx] = useState(0);
  const [progress, setProgress] = useState(0);

  // Keep selected locale valid if the active set changes.
  useEffect(() => {
    if (!locales.some((l) => l.code === locale)) setLocale(locales[0]?.code ?? "en-US");
  }, [locales, locale]);

  // Drive playback: advance a 0→100 progress bar, hop scenes when full.
  useEffect(() => {
    if (!playing) return;
    const tick = 50;
    const step = (100 * tick) / (scenes[sceneIdx].durationSec * 1000);
    const id = setInterval(() => {
      setProgress((p) => {
        if (p + step >= 100) {
          setSceneIdx((s) => (s + 1) % scenes.length);
          return 0;
        }
        return p + step;
      });
    }, tick);
    return () => clearInterval(id);
  }, [playing, sceneIdx, scenes]);

  const scene = scenes[sceneIdx];

  return (
    <Card
      title="Rendered ad"
      icon={<Film className="h-4.5 w-4.5" />}
      accent="bg-brand-50 text-brand-600"
    >
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
        {/* 9:16 player */}
        <div className="relative w-full max-w-[240px] shrink-0 overflow-hidden rounded-2xl bg-black shadow-cardhover">
          <div className={`relative aspect-[9/16] bg-gradient-to-br ${scene.gradient} transition-colors duration-500`}>
            <div className="absolute inset-0 flex flex-col items-center justify-center px-5 text-center">
              <p className="text-lg font-bold leading-snug text-white drop-shadow-lg">
                {scene.narration[locale] ?? scene.narration["en-US"]}
              </p>
            </div>
            <div className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-black/30 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
              <ShieldCheck className="h-3 w-3 text-emerald-300" /> Compliance ✓
            </div>
            <span className="absolute bottom-3 right-3 rounded-md bg-black/30 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
              {sceneIdx + 1}/{scenes.length}
            </span>
            {/* scene segment progress */}
            <div className="absolute inset-x-3 bottom-3 flex gap-1">
              {scenes.map((_, i) => (
                <span key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-white/30">
                  <span
                    className="block h-full rounded-full bg-white"
                    style={{ width: i < sceneIdx ? "100%" : i === sceneIdx ? `${progress}%` : "0%" }}
                  />
                </span>
              ))}
            </div>
          </div>
          <button
            onClick={() => setPlaying((p) => !p)}
            className="absolute inset-0 grid place-items-center opacity-0 transition hover:opacity-100"
          >
            <span className="grid h-12 w-12 place-items-center rounded-full bg-white/90 text-brand-700 shadow-lg">
              {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 translate-x-0.5" />}
            </span>
          </button>
        </div>

        {/* controls / details */}
        <div className="w-full flex-1">
          <div className="mb-4">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <Globe className="h-3.5 w-3.5" /> Language
            </p>
            <div className="flex flex-wrap gap-2">
              {locales.map((l) => (
                <button
                  key={l.code}
                  onClick={() => {
                    setLocale(l.code);
                    setSceneIdx(0);
                    setProgress(0);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    locale === l.code
                      ? "border-brand-300 bg-brand-50 text-brand-700"
                      : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                  }`}
                >
                  <span>{l.flag}</span>
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            {scenes.map((s, i) => (
              <div
                key={s.id}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition ${
                  i === sceneIdx ? "bg-brand-50 text-brand-800" : "text-slate-500"
                }`}
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${i === sceneIdx ? "bg-brand-500" : "bg-slate-300"}`} />
                <span className="font-medium">{s.narration[locale] ?? s.narration["en-US"]}</span>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {liveVideoUrl ? (
              <a
                href={liveVideoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                <ArrowRight className="h-4 w-4" /> Download MP4
              </a>
            ) : (
              <button className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800">
                <ArrowRight className="h-4 w-4" /> Export MP4
              </button>
            )}
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> 9:16 · {scenes.reduce((s, x) => s + x.durationSec, 0)}s · {locale}
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}
