import type { AnalysisResult } from '@/types';

/** Staged status copy shown while the engine "thinks". */
export const ANALYZE_STAGES = [
  'Reading the thread…',
  'Decoding the subtext…',
  'Running vibe diagnostics…',
  'Calibrating your rizz…',
];

type AnalysisSeed = Omit<AnalysisResult, 'id' | 'createdAt'>;

/**
 * Simulation results used when no live AI key is configured (and as a network
 * fallback). Three full variants rotate so repeat analyses feel alive.
 */
/** Non-empty: `seedRotator` indexes into it, so an empty list must be a compile error. */
export const MOCK_ANALYSES: [AnalysisSeed, ...AnalysisSeed[]] = [
  {
    replies: [
      {
        id: 'a',
        style: 'Smooth',
        spice: 2,
        text: "Okay, confession: I've drafted and deleted three replies trying to sound cool. This is the fourth. How's it going?",
      },
      {
        id: 'b',
        style: 'Playful',
        spice: 2,
        text: "You can't just drop that and disappear into your day like I'm supposed to function now.",
      },
      {
        id: 'c',
        style: 'Bold',
        spice: 3,
        text: "Let's skip the small-talk arc. Tacos Thursday or coffee Sunday — dealer's choice.",
      },
    ],
    vibe: {
      persona: 'The Strategic Dry Texter',
      emoji: '🕶️',
      interest: 68,
      confidence: 91,
      traits: ['Replies fast, then vanishes', 'Uses your name (good sign)', 'Punctuation = mood ring'],
      redFlags: ['Never asks a question back', 'The "lol" count is doing heavy lifting'],
      verdict:
        "They're interested but rationing it — classic scarcity play. They mirror your energy about 20 minutes late, which means you set the tempo. Send something with a hook they have to answer, not a status update they can admire and ignore.",
    },
    roast: {
      brutality: 4,
      tagline: 'Certified conversational war crime.',
      text: "You typed 'haha nice' three separate times. Three. A Roomba has more conversational range. They told you a whole story about their weekend and you responded with the emotional depth of a parking receipt. This isn't a dry spell, chief — it's a drought you personally engineered.",
    },
    sims: [
      {
        replyId: 'a',
        probability: 82,
        messages: [
          { from: 'them', text: 'HAHA okay that was smooth, I respect the honesty 😭' },
          { from: 'them', text: 'it\'s going better now that this chat got interesting. what are you up to this week?' },
        ],
      },
      {
        replyId: 'b',
        probability: 74,
        messages: [
          { from: 'them', text: 'lmaooo I have that effect on people' },
          { from: 'them', text: 'ok you\'re funny. keep going' },
        ],
      },
    ],
  },
  {
    replies: [
      {
        id: 'a',
        style: 'Smooth',
        spice: 2,
        text: "For the record, I'm usually way funnier than my last message. I'd like to formally request a redo.",
      },
      {
        id: 'b',
        style: 'Playful',
        spice: 1,
        text: "Rating this conversation 9/10. Docking one point because you still haven't told me your most controversial food opinion.",
      },
      {
        id: 'c',
        style: 'Bold',
        spice: 3,
        text: "I'm going to be honest — texting you is the best part of my screen time report. Let's upgrade it to an actual plan.",
      },
    ],
    vibe: {
      persona: 'The Enthusiastic Overthinker',
      emoji: '🌪️',
      interest: 84,
      confidence: 88,
      traits: ['Triple-texts when excited', 'Edits messages mid-thought', 'Emoji usage: expressive'],
      redFlags: ['Occasionally leaves you on "typing…" purgatory'],
      verdict:
        "High interest, higher anxiety. They're writing novels because they care what you think — that's a green flag wearing a disguise. Don't match the chaos; anchor it. One confident, low-pressure invite will land better than another hour of witty ping-pong.",
    },
    roast: {
      brutality: 3,
      tagline: 'Romance speedrun, any% — failed.',
      text: "You asked 'wyd' at 9:47pm like it's a personality. Then you followed a genuinely great message from them with 'that's crazy'. That's crazy?? They handed you an open door and you complimented the hinges. Your rizz isn't missing — it's in witness protection.",
    },
    sims: [
      {
        replyId: 'a',
        probability: 79,
        messages: [
          { from: 'them', text: 'petition approved, redo granted 😌' },
          { from: 'them', text: 'this better be good' },
        ],
      },
      {
        replyId: 'b',
        probability: 85,
        messages: [
          { from: 'them', text: 'okay FINE. cereal is soup. goodnight.' },
          { from: 'them', text: 'wait no I need to defend this properly, give me a sec' },
        ],
      },
    ],
  },
  {
    replies: [
      {
        id: 'a',
        style: 'Smooth',
        spice: 1,
        text: "I like how you tell stories. Most people summarize — you narrate. What happened next?",
      },
      {
        id: 'b',
        style: 'Playful',
        spice: 2,
        text: "Hold on, I need to screenshot this conversation for the archives. Historians will want to know when the banter peaked.",
      },
      {
        id: 'c',
        style: 'Bold',
        spice: 2,
        text: "Random but confident proposal: you, me, and the farmers market Saturday. I know a guy with life-changing empanadas.",
      },
    ],
    vibe: {
      persona: 'The Warm Slow-Burner',
      emoji: '🔥',
      interest: 73,
      confidence: 86,
      traits: ['Consistent reply cadence', 'Remembers details you mentioned', 'Zero games detected'],
      redFlags: ['Comfortable in the pen-pal zone — needs a nudge'],
      verdict:
        "This one's genuine — steady replies, real questions, callbacks to things you said days ago. The risk isn't rejection, it's stagnation. They'll happily text forever. Someone has to promote this to real life, and it's going to have to be you.",
    },
    roast: {
      brutality: 5,
      tagline: 'The Hague called. They saw the screenshots.',
      text: "Brother. You had a whole paragraph of them being adorable and your response was a thumbs-up react. A THUMBS-UP. That's not a reply, that's a read receipt with extra steps. At this pace your love story gets finished by the heat death of the universe. Send an actual sentence. Today.",
    },
    sims: [
      {
        replyId: 'a',
        probability: 88,
        messages: [
          { from: 'them', text: 'okay nobody has ever noticed that about me before 🥹' },
          { from: 'them', text: 'SO. as I was saying. it gets worse (better):' },
        ],
      },
      {
        replyId: 'b',
        probability: 71,
        messages: [
          { from: 'them', text: 'make sure you get my good angle in the screenshot' },
        ],
      },
    ],
  },
];
