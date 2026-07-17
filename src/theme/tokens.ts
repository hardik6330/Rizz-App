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
  hairline: 'rgba(255,255,255,0.08)',
  hairlineStrong: 'rgba(255,255,255,0.14)',

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
  textTertiary: '#6A6A78',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

export const radii = { sm: 10, md: 14, lg: 20, xl: 28, full: 999 } as const;

export const type = {
  hero: { fontSize: 32, lineHeight: 38, fontWeight: '800', letterSpacing: -0.8, color: palette.textPrimary },
  h1: { fontSize: 27, lineHeight: 33, fontWeight: '800', letterSpacing: -0.5, color: palette.textPrimary },
  h2: { fontSize: 21, lineHeight: 27, fontWeight: '800', letterSpacing: -0.4, color: palette.textPrimary },
  h3: { fontSize: 16, lineHeight: 22, fontWeight: '700', letterSpacing: -0.2, color: palette.textPrimary },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400', color: palette.textPrimary },
  bodyMuted: { fontSize: 15, lineHeight: 22, fontWeight: '400', color: palette.textSecondary },
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
} satisfies Record<string, TextStyle>;

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
export const categoryTheme: Record<string, string> = {
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
