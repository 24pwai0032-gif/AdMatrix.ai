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

/* ─── Product 1: HydroSmart Bottle ────────────────────────────────────────── */
const HYDRO_SCENES: Scene[] = [
  {
    id: "h1",
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
    id: "h2",
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
    id: "h3",
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
    id: "h4",
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

/* ─── Product 2: Wireless Earbuds Pro ─────────────────────────────────────── */
const EARBUDS_SCENES: Scene[] = [
  {
    id: "e1",
    order: 0,
    visualPrompt: "Slow-motion shot of earbuds dropping into their charging case, sparkling light",
    durationSec: 3,
    gradient: "from-purple-500 via-violet-500 to-indigo-500",
    narration: {
      "en-US": "Sound so pure, you'll hear the world differently.",
      "zh-CN": "纯粹音质，重新感受这个世界。",
      "ja-JP": "純粋なサウンドで、世界が変わる。",
      "es-ES": "Un sonido tan puro que escucharás diferente.",
    },
  },
  {
    id: "e2",
    order: 1,
    visualPrompt: "Person jogging through a city wearing earbuds, noise-cancellation waves animated",
    durationSec: 3,
    gradient: "from-fuchsia-500 via-pink-500 to-rose-500",
    narration: {
      "en-US": "Active noise cancellation — silence on demand.",
      "zh-CN": "主动降噪——随时静享专属空间。",
      "ja-JP": "アクティブノイズキャンセリング——いつでも静寂を。",
      "es-ES": "Cancelación activa de ruido — silencio cuando quieras.",
    },
  },
  {
    id: "e3",
    order: 2,
    visualPrompt: "Battery icon animation: 32-hour playback counter ticking up",
    durationSec: 3,
    gradient: "from-amber-400 via-orange-400 to-red-400",
    narration: {
      "en-US": "32 hours of playtime. All day. Every day.",
      "zh-CN": "32小时续航，全天畅听无忧。",
      "ja-JP": "32時間の再生。毎日、一日中。",
      "es-ES": "32 horas de reproducción. Todo el día, cada día.",
    },
  },
  {
    id: "e4",
    order: 3,
    visualPrompt: "Close-up product beauty shot, earbuds floating with launch CTA overlay",
    durationSec: 3,
    gradient: "from-sky-500 via-blue-500 to-indigo-600",
    narration: {
      "en-US": "Wireless Earbuds Pro — order yours today.",
      "zh-CN": "无线耳机 Pro——立即订购。",
      "ja-JP": "ワイヤレスイヤバッズPro——今すぐご注文を。",
      "es-ES": "Auriculares Pro inalámbricos — pide los tuyos hoy.",
    },
  },
];

/* ─── Product 3: Eco Sneaker V2 ───────────────────────────────────────────── */
const SNEAKER_SCENES: Scene[] = [
  {
    id: "sn1",
    order: 0,
    visualPrompt: "Sneaker rotating on a moss-covered pedestal, golden-hour lighting",
    durationSec: 3,
    gradient: "from-green-500 via-emerald-500 to-teal-500",
    narration: {
      "en-US": "Style meets sustainability — meet Eco Sneaker V2.",
      "zh-CN": "时尚与可持续的完美融合——Eco Sneaker V2。",
      "ja-JP": "スタイルとサステナビリティの融合——Eco Sneaker V2。",
      "es-ES": "Estilo y sostenibilidad — conoce el Eco Sneaker V2.",
    },
  },
  {
    id: "sn2",
    order: 1,
    visualPrompt: "Recycled ocean plastic fibers weaving together to form the upper shoe",
    durationSec: 3,
    gradient: "from-cyan-500 via-teal-500 to-green-600",
    narration: {
      "en-US": "Crafted from 100% recycled ocean plastic.",
      "zh-CN": "100% 海洋回收塑料制成，环保先行。",
      "ja-JP": "100%リサイクル海洋プラスチックで作られています。",
      "es-ES": "Fabricado con 100% plástico oceánico reciclado.",
    },
  },
  {
    id: "sn3",
    order: 2,
    visualPrompt: "Athlete jumping on a city rooftop, sneaker sole flexing in slow motion",
    durationSec: 3,
    gradient: "from-lime-400 via-green-400 to-emerald-500",
    narration: {
      "en-US": "Lightweight, breathable, built to move.",
      "zh-CN": "轻盈透气，为运动而生。",
      "ja-JP": "軽量で通気性抜群、動きのために設計。",
      "es-ES": "Ligero, transpirable, diseñado para moverse.",
    },
  },
  {
    id: "sn4",
    order: 3,
    visualPrompt: "End card showing the sneaker with a leaf icon and shop-now CTA",
    durationSec: 3,
    gradient: "from-emerald-600 via-teal-600 to-cyan-600",
    narration: {
      "en-US": "Walk lighter on the planet — shop now.",
      "zh-CN": "轻踏地球，立即选购。",
      "ja-JP": "地球に優しく歩こう——今すぐ購入。",
      "es-ES": "Camina más ligero en el planeta — compra ahora.",
    },
  },
];

/* ─── Demo product catalogue ──────────────────────────────────────────────── */
export const DEMO_PRODUCT: DemoProduct = {
  url: "https://demo.admatrix.ai/products/hydro-smart-bottle",
  brand: {
    productName: "HydroSmart Bottle",
    tagline: "Hydration, reimagined.",
    tone: "Energetic · Premium · Wellness-forward",
    audience: "Health-conscious millennials & Gen-Z, 18–35",
    colors: ["#0ea5e9", "#6366f1", "#10b981", "#f43f5e"],
  },
  scenes: HYDRO_SCENES,
};

const EARBUDS_PRODUCT: DemoProduct = {
  url: "https://shop.example.com/wireless-earbuds-pro",
  brand: {
    productName: "Wireless Earbuds Pro",
    tagline: "Sound so pure, you'll hear the world differently.",
    tone: "Bold · Tech-forward · Premium",
    audience: "Music lovers & commuters, 20–40",
    colors: ["#7c3aed", "#db2777", "#f59e0b", "#0ea5e9"],
  },
  scenes: EARBUDS_SCENES,
};

const SNEAKER_PRODUCT: DemoProduct = {
  url: "https://store.example.com/eco-sneaker-v2",
  brand: {
    productName: "Eco Sneaker V2",
    tagline: "Style meets sustainability.",
    tone: "Conscious · Energetic · Aspirational",
    audience: "Eco-conscious active lifestyle, 22–38",
    colors: ["#10b981", "#0d9488", "#84cc16", "#06b6d4"],
  },
  scenes: SNEAKER_SCENES,
};

/** Look up the correct demo product for a given URL. Falls back to the hydro bottle. */
export function getDemoProduct(url: string): DemoProduct {
  if (url.includes("wireless-earbuds")) return EARBUDS_PRODUCT;
  if (url.includes("eco-sneaker")) return SNEAKER_PRODUCT;
  return DEMO_PRODUCT;
}

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
