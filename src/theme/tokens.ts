import { Platform, type TextStyle, type ViewStyle } from 'react-native';

/**
 * RizzCoach design tokens — premium dark iOS.
 * Every component reads from these; never hardcode hex or px in screens.
 */

export const palette = {
  // Base surfaces
  black: '#050508',
  ink: '#0A0A12', // app background
  surface: '#13131E', // cards
  surfaceHigh: '#1B1B2A', // elevated cards / chips
  /**
   * Below ground, not above it — input wells, quote blocks, the search field.
   *
   * The elevation model had no way to say "recessed": a well drawn on `surface`
   * had to be `surfaceHigh`, which is the token for something raised, so an
   * input read as a button. Darker than `ink` so it reads as a hole in the card
   * rather than another card.
   */
  surfaceInset: '#0E0E18',
  hairline: 'rgba(255,255,255,0.08)',
  hairlineStrong: 'rgba(255,255,255,0.14)',
  /** The one modal backdrop. Was written by hand, differently, on three screens. */
  scrim: 'rgba(5,5,8,0.72)',

  // Brand
  violet: '#8B5CF6',
  violetBright: '#A78BFA',
  violetDeep: '#5B2EDD',
  pink: '#FF4D8D',
  ember: '#FF6B4A',
  gold: '#F2C14E',
  mint: '#3DDC97',
  cyan: '#38D6FF',
  danger: '#FF5C5C',

  // Text
  textPrimary: '#F7F7FA',
  textSecondary: '#A2A2B5',
  /*
   * Lightened from #6A6A78 for WCAG AA. It carries 12–12.5px copy (analyzer step
   * bodies, paywall footnotes, vault captions) and TextInput placeholders, so it is
   * "normal" text at 4.5:1, not large text at 3:1 — and it measured 3.19:1 on
   * surfaceHigh, the worst of the three surfaces. This clears it at 4.75:1 while
   * staying a step below textSecondary (6.77:1); lighten it further and the two
   * greys collapse into one. Check any new grey against all three surfaces.
   */
  textTertiary: '#868697',
} as const;

/**
 * Status colours, named for what they MEAN rather than what they are.
 *
 * `gold` was doing two unrelated jobs — "the bubble was killed, act on this" and
 * "this line is a Closer" — and a palette entry with two meanings is how the
 * next person picks the wrong one. Screens showing state read from here; the raw
 * brand colours stay for fills, category tints and gradients.
 */
export const semantic = {
  success: palette.mint,
  warning: palette.gold,
  error: palette.danger,
  info: palette.cyan,
  /** Flat, not the brand colour at low opacity — see the note in Button.tsx. */
  disabled: palette.surfaceHigh,
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

export const radii = { sm: 10, md: 14, lg: 20, xl: 28, full: 999 } as const;

/*
 * Twelve roles. Screens pick one and override nothing but `color`.
 *
 * This replaced 31 distinct hardcoded sizes (including 14.5, 12.5, 11.5, 16.5,
 * 15.5, 13.5, 10.5) spread over 215 call sites — the reason the app read as
 * slightly different on every screen. `display` and `micro` are the two ends
 * nothing covered; `reply` exists so the generated line is never mistaken for
 * UI chrome; `bodySm` absorbs the 13/13.5/14 band.
 */
export const type = {
  display: { fontSize: 31, lineHeight: 36, fontWeight: '900', letterSpacing: -1, color: palette.textPrimary },
  hero: { fontSize: 32, lineHeight: 38, fontWeight: '800', letterSpacing: -0.8, color: palette.textPrimary },
  h1: { fontSize: 27, lineHeight: 33, fontWeight: '800', letterSpacing: -0.5, color: palette.textPrimary },
  h2: { fontSize: 21, lineHeight: 27, fontWeight: '800', letterSpacing: -0.4, color: palette.textPrimary },
  h3: { fontSize: 17, lineHeight: 23, fontWeight: '700', letterSpacing: -0.2, color: palette.textPrimary },
  /** The generated line itself. Regular weight, generous leading — it is content, not chrome. */
  reply: { fontSize: 17, lineHeight: 25, fontWeight: '400', color: palette.textPrimary },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400', color: palette.textPrimary },
  bodyMuted: { fontSize: 15, lineHeight: 22, fontWeight: '400', color: palette.textSecondary },
  bodySm: { fontSize: 13.5, lineHeight: 19, fontWeight: '400', color: palette.textSecondary },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: palette.textPrimary },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500', color: palette.textSecondary },
  overline: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: palette.textSecondary,
  },
  /** Count bubbles and live badges only. Always pair with maxFontSizeMultiplier={1}. */
  micro: { fontSize: 10, lineHeight: 13, fontWeight: '800', letterSpacing: 1.2, color: palette.textSecondary },
} satisfies Record<string, TextStyle>;

/**
 * Emoji sizes. Not typography — a glyph has no weight, tracking or colour, and
 * snapping one to `type` would drag a line-height and a text colour onto it.
 *
 * It exists so the ESLint ban on raw `fontSize` needs no exceptions: the nine
 * emoji that survived the type migration were the only things left keeping the
 * rule advisory, and a rule with nine escape hatches stops being enforced.
 */
export const glyph = { sm: 12, md: 13, lg: 16, xl: 24, xxl: 44 } as const;

/** Spreadable absolute-fill (RN 0.86 removed StyleSheet.absoluteFillObject). */
export const absoluteFill: ViewStyle = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
};

/** Colored soft glow — iOS shadows; static elevation on Android. */
export function glow(color: string, opacity = 0.45, radius = 22): ViewStyle {
  return Platform.select<ViewStyle>({
    ios: {
      shadowColor: color,
      shadowOpacity: opacity,
      shadowRadius: radius,
      shadowOffset: { width: 0, height: 6 },
    },
    default: { elevation: 12 },
  });
}

/** Per-category accent colors used by the feed, vault and chips. */
const categoryTheme: Record<string, string> = {
  Opener: palette.violet,
  Comeback: palette.pink,
  Recovery: palette.cyan,
  Closer: palette.gold,
  Engine: palette.violetBright,
  Bio: palette.mint,
};

export function categoryColor(category: string): string {
  return categoryTheme[category] ?? palette.violet;
}
