/** Engine analysis modes. */
export type EngineMode = 'rizz' | 'vibe' | 'roast';

export type ReplyStyle = 'Smooth' | 'Playful' | 'Bold';

export interface ReplyOption {
  id: string;
  style: ReplyStyle;
  text: string;
  /** 1 = safe, 3 = spicy */
  spice: 1 | 2 | 3;
}

export interface SimMessage {
  from: 'you' | 'them';
  text: string;
}

/** A simulated "what happens if you send this" thread for one reply option. */
export interface SimThread {
  replyId: string;
  /** 0–100 likelihood of this outcome. */
  probability: number;
  messages: SimMessage[];
}

export interface VibeCheck {
  /** Archetype, e.g. "The Strategic Dry Texter". */
  persona: string;
  emoji: string;
  /** 0–100 interest level. */
  interest: number;
  traits: string[];
  redFlags: string[];
  verdict: string;
  /** 0–100 model confidence. */
  confidence: number;
}

export interface Roast {
  text: string;
  /** 1–5 skulls. */
  brutality: number;
  tagline: string;
}

/**
 * One analysis. Sections are optional: the engine is scoped by `EngineMode` and
 * only returns the sections the picked mode renders. Mock seeds carry all four.
 */
export interface AnalysisResult {
  id: string;
  createdAt: number;
  /** What the model actually read off the screenshot. Absent on mock seeds. */
  read?: { lastMessage: string; lastFrom: 'them' | 'you'; thread: string };
  replies?: ReplyOption[];
  vibe?: VibeCheck;
  roast?: Roast;
  /** Simulated outcomes, one per reply option. */
  sims?: SimThread[];
}

export type FeedCategory = 'Opener' | 'Comeback' | 'Recovery' | 'Closer';

export interface FeedItem {
  id: string;
  category: FeedCategory;
  text: string;
  /** When to deploy the line. */
  context: string;
  /** 0–100 reported reply rate. */
  successRate: number;
  testedBy: {
    name: string;
    age: number;
    /** RN asset id from require(), or null to hide the avatar. */
    avatar: number | null;
  };
  background: {
    /** RN asset id from require(), or null to fall back to a code gradient. */
    image: number | null;
    /** Gradient fallback, top → bottom. */
    colors: [string, string, string];
  };
}

export interface SavedItem {
  id: string;
  text: string;
  /**
   * FeedCategory, "Engine" (analysis engine) or "Bio" (bio optimizer).
   *
   * This is also where the item came from — "Engine" and "Bio" name their
   * producer and everything else is a feed line. A separate `source` field used
   * to say the same thing a second time; `saved_items` has no column for it, so
   * every item that came back from the server had a required field that was
   * `undefined` at runtime, behind a cast that hid it. Nothing ever read it.
   */
  category: FeedCategory | 'Engine' | 'Bio';
  savedAt: number;
}

// --- Bio Optimizer ---------------------------------------------------------

export type BioTone = 'Playful' | 'Sincere' | 'Mysterious';
export type BioVibe = 'Funny' | 'Sarcastic' | 'Chill' | 'Ambitious';

export interface BioOption {
  id: string;
  tone: BioTone;
  /** Human-facing style label, e.g. "Playful & Witty". */
  label: string;
  text: string;
}

export interface BioResult {
  id: string;
  createdAt: number;
  bios: BioOption[];
}

export interface BioInput {
  /** Selected chip labels plus any custom interests. */
  interests: string[];
  vibe: BioVibe;
  /** Existing bio to rewrite, if any. */
  currentBio?: string;
}

// --- Profile Scan ("Improve my profile" report) ----------------------------

export interface ProfileScore {
  /** 0–10. */
  score: number;
  note: string;
}

/**
 * Who the scan is about.
 * - 'self' — coach my own profile (the original glow-up report).
 * - 'them' — read someone else's profile and hand me openers.
 *
 * One result shape serves both; `swipeStopper` / `intentClarity` are the two
 * generic score slots and `PROFILE_LABELS` renames them per mode. Keeping one
 * shape means one schema, one engine and one report renderer.
 */
export type ScanMode = 'self' | 'them';

export interface ProfileScanResult {
  id: string;
  createdAt: number;
  /**
   * Which mode produced this report.
   *
   * Stamped by the engine rather than tracked beside it, because `PROFILE_LABELS`
   * renames every section per mode: a 'them' report reopened from history while
   * the screen sits in 'self' would relabel openers as bio lines and score a
   * stranger's profile as the user's own.
   */
  mode: ScanMode;
  /** False when the screenshots aren't a readable dating/social profile. */
  isProfile: boolean;
  /** Set only when isProfile is false — a short reason to show the user. */
  rejectionReason?: string;
  /** Name pulled from the profile, if visible. */
  name?: string;
  /** The age/location line under the name, e.g. "GJ 21". */
  tagline?: string;
  /** Opening summary paragraph. */
  summary: string;
  swipeStopper: ProfileScore;
  intentClarity: ProfileScore;
  /** "What's working & what to fix" — 1–3 paragraphs. */
  workingAndFix: string[];
  /** Plug-and-play bio lines the user can copy/save. */
  bioLines: string[];
  /** "If you only fix 1 thing today…" */
  quickWin: string;
  /** Photo tune-up bullet tips. */
  photoTuneUp: string[];
  /** How the profile stacks up against the competition — bullet tips. */
  competition: string[];
}

export interface ProfileImage {
  base64: string;
  mimeType: string;
}

export interface ProfileScanInput {
  /** 1–3 profile screenshots analyzed together. */
  images: ProfileImage[];
  /** Defaults to 'self' so existing callers keep their behaviour. */
  mode?: ScanMode;
}

/** Apps the accessibility capture recognises. */
export type SupportedApp = 'instagram' | 'tinder' | 'bumble' | 'hinge' | 'facebook-dating';

/**
 * One captured profile, however it was acquired — picked from the gallery, shared
 * in, or grabbed by the accessibility bubble. Everything past `images` is optional
 * so every source produces the same shape and `analyzeProfile` never has to care
 * which one it came from.
 *
 * This is the seam that keeps v2 (chat analysis) cheap: a new capture kind reuses
 * it rather than forcing a refactor.
 */
export interface ProfileCapture extends ProfileScanInput {
  /** Known for accessibility captures, absent for gallery picks. */
  app?: SupportedApp;
  /**
   * Text scraped from the accessibility tree. A HINT to disambiguate the image —
   * never the primary input. The tree gives nothing about photos, which is where
   * most of the report's value lives, so the image stays authoritative.
   */
  uiText?: string;
  /** 0–1 screen-detection confidence. */
  confidence?: number;
}

/**
 * The three first-run answers, and the only personalisation the engines get.
 *
 * **These values are a wire contract.** They are sent verbatim to
 * `/v1/ai/{lab,profile,bio}` and matched against closed zod enums there — see
 * `COACH_APPS` / `COACH_STRUGGLES` / `COACH_STYLES` in
 * `backend/src/ai/prompts.ts`. Renaming one here without renaming it there does
 * not fail: the server drops the unknown value and the user quietly gets generic
 * output, which is the exact failure the onboarding exists to prevent. Change
 * both, or neither.
 */
export type CoachApp = 'tinder' | 'bumble' | 'hinge' | 'instagram' | 'whatsapp' | 'snapchat';
export type CoachStruggle = 'opening' | 'keeping' | 'asking_out' | 'replying';
export type CoachStyle = 'casual' | 'funny' | 'dry' | 'flirty' | 'short';

export interface CoachProfile {
  apps: CoachApp[];
  struggle: CoachStruggle;
  style: CoachStyle;
}
