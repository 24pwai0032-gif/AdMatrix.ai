// Self-contained demo dataset + simulation model for AdMatrix.ai.
// Everything the standalone demo needs lives here — no backend required.

export type StageKey =
  | "draft"
  | "scraping"
  | "transcreation"
  | "storyboarding"
  | "awaiting_approval"
  | "audio_generating"
  | "video_rendering"
  | "lip_syncing"
  | "compliance_check"
  | "completed";

export interface Stage {
  key: StageKey;
  label: string;
  detail: string;
  /** simulated duration in ms (ignored for the HITL pause stage) */
  duration: number;
}

// The visible pipeline. `awaiting_approval` is the human-in-the-loop pause.
export const PIPELINE: Stage[] = [
  { key: "scraping", label: "Ingesting", detail: "Scraping product page & assets", duration: 2200 },
  { key: "transcreation", label: "Transcreating", detail: "Dual-pass localization with Qwen", duration: 2600 },
  { key: "storyboarding", label: "Storyboarding", detail: "Generating scene panels (Wan Image)", duration: 2400 },
  { key: "awaiting_approval", label: "Review", detail: "Awaiting your approval", duration: 0 },
  { key: "audio_generating", label: "Audio", detail: "Text-to-speech, locking durations", duration: 2000 },
  { key: "video_rendering", label: "Rendering", detail: "Wan2.7 / HappyHorse I2V per scene", duration: 3200 },
  { key: "lip_syncing", label: "Lip-sync", detail: "Audio-visual mouth morphing", duration: 2200 },
  { key: "compliance_check", label: "Compliance", detail: "Qwen safety + brand check", duration: 1800 },
];

export interface Locale {
  code: string;
  label: string;
  flag: string;
}

export const LOCALES: Locale[] = [
  { code: "en-US", label: "English (US)", flag: "🇺🇸" },
  { code: "zh-CN", label: "中文 (简体)", flag: "🇨🇳" },
  { code: "ja-JP", label: "日本語", flag: "🇯🇵" },
  { code: "es-ES", label: "Español", flag: "🇪🇸" },
];

export interface Scene {
  id: string;
  order: number;
  visualPrompt: string;
  durationSec: number;
  /** localized narration keyed by locale code */
  narration: Record<string, string>;
  /** tailwind gradient classes used to render the mock panel art */
  gradient: string;
}

export interface BrandBook {
  productName: string;
  tagline: string;
  tone: string;
  audience: string;
  colors: string[];
}

export interface DemoProduct {
  url: string;
  brand: BrandBook;
  scenes: Scene[];
}

const SCENES: Scene[] = [
  {
    id: "s1",
    order: 0,
    visualPrompt: "Cinematic hero shot of the bottle on a marble counter, soft morning light",
    durationSec: 3,
    gradient: "from-sky-400 via-cyan-400 to-blue-500",
    narration: {
      "en-US": "Meet hydration, reimagined.",
      "zh-CN": "重新定义你的每一次补水。",
      "ja-JP": "水分補給を、再発明。",
      "es-ES": "Conoce la hidratación, reinventada.",
    },
  },
  {
    id: "s2",
    order: 1,
    visualPrompt: "Close-up of the companion app, animated sip-tracking rings filling up",
    durationSec: 3,
    gradient: "from-violet-400 via-indigo-400 to-brand-500",
    narration: {
      "en-US": "Track every sip, right from your phone.",
      "zh-CN": "每一口饮水，手机随时掌握。",
      "ja-JP": "ひと口ごとに、スマホで記録。",
      "es-ES": "Controla cada sorbo desde tu teléfono.",
    },
  },
  {
    id: "s3",
    order: 2,
    visualPrompt: "Macro of ice cubes inside the bottle, condensation, 24h cold lock badge",
    durationSec: 3,
    gradient: "from-emerald-400 via-teal-400 to-cyan-500",
    narration: {
      "en-US": "Twenty-four hours of perfect cold.",
      "zh-CN": "24 小时，恒久冰爽。",
      "ja-JP": "24時間、冷たさをキープ。",
      "es-ES": "Veinticuatro horas de frío perfecto.",
    },
  },
  {
    id: "s4",
    order: 3,
    visualPrompt: "End card with logo, CTA button, limited-offer ribbon",
    durationSec: 3,
    gradient: "from-rose-400 via-pink-400 to-fuchsia-500",
    narration: {
      "en-US": "Shop now — limited launch offer.",
      "zh-CN": "立即选购——限量上市优惠。",
      "ja-JP": "今すぐ購入——数量限定オファー。",
      "es-ES": "Compra ahora — oferta de lanzamiento.",
    },
  },
];

export const DEMO_PRODUCT: DemoProduct = {
  url: "https://demo.admatrix.ai/products/hydro-smart-bottle",
  brand: {
    productName: "HydroSmart Bottle",
    tagline: "Hydration, reimagined.",
    tone: "Energetic · Premium · Wellness-forward",
    audience: "Health-conscious millennials & Gen-Z, 18–35",
    colors: ["#0ea5e9", "#6366f1", "#10b981", "#f43f5e"],
  },
  scenes: SCENES,
};

export const SAMPLE_URLS = [
  "https://demo.admatrix.ai/products/hydro-smart-bottle",
  "https://shop.example.com/wireless-earbuds-pro",
  "https://store.example.com/eco-sneaker-v2",
];

export interface ModelCost {
  model: string;
  calls: number;
  cost: number;
}

export const BUDGET_USD = 10;

// Cost ledger grows as the pipeline progresses. Index aligns with PIPELINE stage reached.
export const COST_LEDGER: ModelCost[] = [
  { model: "qwen3.6-plus", calls: 11, cost: 1.42 },
  { model: "wan-image", calls: 4, cost: 0.96 },
  { model: "wan2.7-video", calls: 4, cost: 3.18 },
  { model: "happyhorse-i2v", calls: 4, cost: 1.74 },
];
