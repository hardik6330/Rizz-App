import { coachPayload } from '@/state/useRizzStore';
import type { ProfileCapture, ProfileScanInput, ProfileScanResult, ScanMode } from '@/types';
import { uid, wait } from '@/utils/misc';
import { callApi, imagePayload, isLiveApi } from './api';

/**
 * The Profile Scan engine — Gemini vision over 1–3 profile screenshots.
 *
 * Two modes, ONE result shape, one schema, one report renderer:
 * - 'self' — audit my own profile and coach a glow-up.
 * - 'them' — read someone else's profile and hand me openers.
 *
 * The shape is deliberately shared. `swipeStopper` / `intentClarity` are two
 * generic score slots that `PROFILE_LABELS` renames per mode, and `bioLines`
 * carries bio lines in 'self' mode and openers in 'them' mode — both are
 * copy/save-to-vault strings, so the existing UI works untouched.
 *
 * Shared transport lives in `api.ts`. Never hand-roll a fetch.
 *
 * Both system prompts — including the 'them'-mode HARD RULES block, which is
 * the thing keeping this feature ethical — now live on the server, where
 * `assertSafetyRails()` refuses to boot if they are edited away.
 */

/** Staged status copy shown while a profile is being scanned. */
export const PROFILE_STAGES: Record<ScanMode, string[]> = {
  self: [
    'Reading your photos…',
    'Scoring swipe-stopping power…',
    'Auditing the bio & intent…',
    'Writing your glow-up plan…',
  ],
  them: [
    'Reading their photos…',
    'Picking up on the vibe…',
    'Reading between the bio lines…',
    'Writing your openers…',
  ],
};

/**
 * Per-mode section headings. The result shape is generic; these give it voice.
 * Screens read from here so the two modes can never drift apart visually.
 */
export const PROFILE_LABELS: Record<
  ScanMode,
  {
    title: string;
    heroTitle: string;
    heroSub: string;
    dropTitle: string;
    dropSubtitle: string;
    scoreA: string;
    scoreB: string;
    workingAndFix: string;
    lines: string;
    linesHint: string;
    quickWin: string;
    photo: string;
    competition: string;
    /** Short pill labels. The section titles above are too long for three tabs. */
    tabs: { quick: string; photo: string; comp: string };
    fallbackName: string;
    disclaimer: string;
  }
> = {
  self: {
    title: 'Improve my profile',
    heroTitle: 'Score your profile.\nGet the glow-up.',
    heroSub: 'Drop your profile. The coach does the rest.',
    dropTitle: 'Drop your profile',
    dropSubtitle: 'Up to 3 screenshots — bio, prompts, photos.',
    scoreA: 'Swipe-Stopper Score',
    scoreB: 'Intent Clarity Score',
    workingAndFix: "What's working & what to fix",
    lines: 'Plug-and-play bio lines',
    linesHint: 'Tap copy to steal a line…',
    quickWin: 'Quick wins',
    photo: 'Photo tune-up',
    competition: 'Competition',
    tabs: { quick: 'Quick wins', photo: 'Photos', comp: 'Compete' },
    fallbackName: 'Your profile',
    disclaimer:
      "Remember that this analysis is just an educated guess. Human behavior is complex and unpredictable, and a profile alone can't guarantee someone's true intentions.",
  },
  them: {
    title: 'Read their profile',
    heroTitle: 'Read the room.\nOpen with intent.',
    heroSub: 'Drop their profile. Get openers that actually land.',
    dropTitle: 'Drop their profile',
    dropSubtitle: 'Up to 3 screenshots — bio, prompts, photos.',
    scoreA: 'First Impression',
    scoreB: 'Shared-Interest Signal',
    workingAndFix: 'What their profile is telling you',
    lines: 'Openers that fit',
    linesHint: 'Tap copy to send one…',
    quickWin: 'Your best opening move',
    photo: 'Photo read',
    competition: 'Things worth asking about',
    tabs: { quick: 'Best move', photo: 'Photos', comp: 'Ask about' },
    fallbackName: 'Their profile',
    disclaimer:
      "This is an educated guess from a few screenshots, not a read on a real person's character or intentions. Treat it as conversation prep — they're a whole human, not a score.",
  },
};

/**
 * Mock seeds are DEMO MODE ONLY — they must never stand in for a failed call.
 *
 * This used to catch every failure and return a seed, so an outage was
 * indistinguishable from a working app: a user scanned their own profile and got
 * back a report about "Maya, Bristol 26" — a stranger's name, a stranger's
 * pottery hobby — which `addScan` then wrote into their history as if it were
 * real. They would send an opener about pottery to someone with no pottery.
 *
 * With a live API a failure now throws, and `profile.tsx` already has the catch
 * that toasts and returns to the drop pad. The seeds stay for `!isLiveApi`,
 * which is the case they were written for.
 */
export async function analyzeProfile(input: ProfileScanInput): Promise<ProfileScanResult> {
  const mode = input.mode ?? 'self';
  if (!isLiveApi) return simulateScan(mode);
  return analyzeViaApi(input, mode);
}

// ---------------------------------------------------------------------------
// Live path — POST /v1/ai/profile
// ---------------------------------------------------------------------------

async function analyzeViaApi(
  input: ProfileScanInput,
  mode: ScanMode,
): Promise<ProfileScanResult> {
  const { uiText } = input as ProfileCapture;
  const parsed = await callApi<Omit<ProfileScanResult, 'id' | 'createdAt' | 'mode'>>('/v1/ai/profile', {
    images: input.images.map((img) => imagePayload(img.base64, img.mimeType)),
    mode,
    // Accessibility captures carry the on-screen text. It is a hint only, and the
    // server fences it into the user turn — never the system instruction —
    // because it comes off a screen an attacker may control.
    ui_text: uiText,
    coach: coachPayload(),
  });
  const res = parsed as { id?: string };
  return { ...parsed, id: res.id ?? uid(), createdAt: Date.now(), mode };
}

// ---------------------------------------------------------------------------
// Simulation path — offline demo mode
// ---------------------------------------------------------------------------

type ScanSeed = Omit<ProfileScanResult, 'id' | 'createdAt' | 'mode'>;

/**
 * Non-empty on purpose: `simulateScan` indexes into these, so a mode with an
 * empty seed list would crash the offline demo. The tuple type makes that a
 * compile error instead of a runtime one.
 */
const MOCK_SCANS: Record<ScanMode, [ScanSeed, ...ScanSeed[]]> = {
  them: [
    {
      isProfile: true,
      name: 'Maya',
      tagline: 'Bristol 26',
      summary:
        "She's put real effort in here — the prompts do the work and there's a clear thread of someone who likes making things. Lead with the pottery; it's the most specific thing on the page.",
      swipeStopper: {
        score: 8,
        note: 'Strong, distinctive first impression — the photos have a consistent point of view and the prompts read like an actual person wrote them rather than a template.',
      },
      intentClarity: {
        score: 7,
        note: "Plenty to work with: pottery, the Lisbon trip and a stated opinion about coriander. The pottery is the richest hook — it's specific and she's clearly proud of it.",
      },
      workingAndFix: [
        "The profile is signalling someone who makes things and travels with intent — a pottery wheel in one shot, a half-finished mug in another, and a Lisbon photo that isn't the usual landmark shot. This is a person who'd rather show you a hobby than list adjectives.",
        "The humour is dry and self-aware — the coriander line is a joke that invites a response rather than closing the topic. She's left obvious doors open, which usually means she wants to be asked.",
      ],
      bioLines: [
        "Okay, the coriander take is bold and I need to know how far it goes — is it a texture thing or a taste thing?",
        "That mug on the wheel looks dangerously close to collapsing. Did it survive, and do you have a graveyard of ones that didn't?",
        "Lisbon but no tram photo — respect. Where did you actually end up eating?",
        "How long into pottery before you made something you'd genuinely let a guest drink out of?",
      ],
      quickWin:
        "If you send one thing, send THIS: ask about the mug on the wheel. It's the most specific object on the profile, she chose to show it, and it's a question she can answer with a story rather than a yes.",
      photoTuneUp: [
        'Pottery wheel with a work in progress — a hobby she does, not just one she lists.',
        'Lisbon shot framed away from the obvious landmarks; suggests she travels to wander.',
        'A dog in two photos, comfortable with her — likely hers rather than a prop.',
        'Consistent handmade ceramics in the background of the indoor shots.',
        'Group photo is small and relaxed — a few close friends rather than a big night out.',
      ],
      competition: [
        'What got her into pottery in the first place — hobbies picked up as adults usually have a story.',
        'Whether she sells the ceramics or just gives them away.',
        'What the coriander opinion is actually based on.',
        'What made her pick Lisbon over the more obvious options.',
        "Whether the dog is hers, and what it's called.",
      ],
    },
  ],
  self: [
  {
    isProfile: true,
    name: 'Ardesh',
    tagline: 'GJ 21',
    summary:
      "You've got some good vibes, but let's ditch the mystery and add a dash of personality to your profile for maximum glow-up.",
    swipeStopper: {
      score: 5,
      note: 'Your photo game is solid but could use a serious boost in clarity and expression. You score better than 30% of profiles — brighter, more engaging shots that truly pop get you into the big leagues.',
    },
    intentClarity: {
      score: 4,
      note: "Your bio gives a peek into your values, but it's time to truly reveal the epic human you are. You're clearer than 35% of profiles — a few specifics make you a magnet for the right connections.",
    },
    workingAndFix: [
      "Right now, your profile hints at your cultural roots and shows a few full-body shots, which is a great start. You look active and enjoy being outdoors, and you're not afraid to put yourself out there — half the battle.",
      "Time for an upgrade: ditch the blurry, dark or overly filtered photos that hide your face. Keep the full-body shots but add more genuine, beaming smiles. Add a specific hobby, passion, or quirky tidbit to your bio that screams 'This is me!'",
    ],
    bioLines: [
      "I'm a connoisseur of bad puns and good company. Seeking someone who finds both equally charming.",
      'Weekend plans usually involve a trail, a playlist, and one questionable food experiment. Bring snacks.',
      'Fluent in sarcasm, decent at cooking, dangerously competitive at mini-golf.',
    ],
    quickWin:
      'If you only fix 1 thing today, do THIS: Replace your current profile picture with a clear, well-lit shot of you smiling directly at the camera. Then swap one dark photo for a pic of you doing a hobby you love.',
    photoTuneUp: [
      'Lead Photo: Clear, well-lit solo shot of you smiling directly at the camera (no hats or sunglasses).',
      'Variety is Key: Include 1-2 full-body shots and 1-2 photos of you engaged in a hobby or activity.',
      'Lighting Check: Ensure all photos are bright and taken in natural light — ditch the dark indoor pics.',
      'Ditch the Mystery: Remove any photos where your face is obscured by filters, shadows, or props.',
      "Show Your People: Include one group photo, but make sure you're easily identifiable and looking your best.",
      "Smile Power: Add more photos where you're genuinely smiling — it's a universal attractant!",
    ],
    competition: [
      "Specificity wins: swap 'I love to travel' for the one trip that changed you.",
      'Lead with a hobby photo — most profiles open with a mirror selfie, so a real activity shot stands out instantly.',
      'End your bio with a low-effort question or hook so matches have something easy to reply to.',
      'Pick photos with pops of color; they stop the scroll faster than muted tones.',
    ],
  },
  {
    isProfile: true,
    name: 'Sam',
    tagline: '27',
    summary:
      "Strong foundation here — you read as fun and easygoing. A little more intention and a couple of brighter photos will take this from 'swipe maybe' to 'swipe yes.'",
    swipeStopper: {
      score: 7,
      note: 'Your photos already stop the scroll — you beat about 60% of profiles. One crisp lead photo with eye contact would push you into the top tier.',
    },
    intentClarity: {
      score: 5,
      note: "Fun bio, but it's a little coy about what you're actually after. Naming what you want filters for the right people instead of everyone.",
    },
    workingAndFix: [
      'What works: your photos feel candid and warm, and there\'s a clear sense of humor in the bio. People can already picture hanging out with you.',
      'What to fix: add one line about what you\'re looking for, and replace the busiest group shot with a clean solo photo so nobody has to guess which one is you.',
    ],
    bioLines: [
      'Here for good coffee, better conversations, and someone to lose at board games with.',
      'Part-time chef, full-time dog person, occasional karaoke menace.',
      "I'll show you my favorite taco spot if you show me the playlist you\'re embarrassed to admit you love.",
    ],
    quickWin:
      'If you only fix 1 thing today, do THIS: add a single sentence to your bio saying what kind of connection you\'re looking for. Clarity is magnetic.',
    photoTuneUp: [
      'Lead Photo: a bright solo shot with clear eye contact and a real smile.',
      'Cut the clutter: keep only one group photo, and make sure you\'re the obvious focus.',
      'Add an action shot: you doing the thing you love most reads as instantly attractive.',
      'Natural light beats filters every time — retire the heavily edited pics.',
      'Include one full-body photo so the profile feels honest and complete.',
    ],
    competition: [
      'Most bios stay vague — stating your intent puts you ahead of 80% of profiles.',
      'A genuine laughing photo out-performs a posed one; add at least one.',
      'Reference something oddly specific (a niche snack, a hobby) — it invites replies.',
    ],
  },
  ],
};

const rotation: Record<ScanMode, number> = { self: 0, them: 0 };

async function simulateScan(mode: ScanMode): Promise<ProfileScanResult> {
  const seeds = MOCK_SCANS[mode];
  await wait(PROFILE_STAGES[mode].length * 850 + 500);
  const seed = seeds[rotation[mode] % seeds.length];
  rotation[mode] += 1;
  const clone = JSON.parse(JSON.stringify(seed)) as ScanSeed;
  return { ...clone, id: uid(), createdAt: Date.now(), mode };
}
