import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { spacing } from './tokens';

/**
 * Responsive layout rules — the sizing decisions that depend on the *device*,
 * not on the design language. Colours, type and spacing stay in `tokens.ts`;
 * this file only says how much of them a given screen gets.
 *
 * It exists because the same two numbers were hardcoded in every screen: a 24pt
 * gutter (which eats a sixth of a 320pt phone and strands a text column in the
 * middle of a tablet) and a flat 148pt of bottom padding standing in for the
 * floating tab bar (which grows with the OS font scale, so the last card slid
 * underneath it at large text sizes). Both are now derived.
 */

/**
 * Vertical hit-slop for the filter chips on Discover and the Vault.
 *
 * Both rows are ~30pt tall (7pt padding on 16pt of line box), against a 44pt iOS
 * / 48dp Android minimum. Growing the padding instead would push the Discover
 * row down over the feed card behind it, so the target grows and the pill does
 * not. **Vertical only, deliberately**: the chips sit 8pt apart horizontally and
 * a symmetric slop would make neighbouring targets overlap, which trades a small
 * target for an ambiguous one.
 */
export const CHIP_HIT_SLOP = { top: 9, bottom: 9, left: 0, right: 0 } as const;

/**
 * Vertical hit-slop for the four tab-bar items. Same rule as `CHIP_HIT_SLOP`
 * above, same reason it is vertical only.
 *
 * An item is `paddingVertical: 11` around a 19pt icon — 41pt, against the 44pt
 * iOS minimum. Growing the padding instead would grow the pill, and the pill's
 * geometry is what `clearanceFor` below derives every screen's bottom padding
 * from — so a 3pt fix would quietly reflow four screens. The target grows and the
 * bar does not.
 *
 * Horizontal stays 0: the items sit 4pt apart inside the pill, so symmetric slop
 * would overlap neighbours and trade a small target for an ambiguous one.
 */
export const TAB_HIT_SLOP = { top: 3, bottom: 3, left: 0, right: 0 } as const;

/** Widest a text column ever gets; past this the gutters absorb the slack. */
export const CONTENT_MAX = 560;

/** Below this width the standard 24pt gutter takes too much of the screen. */
const COMPACT_WIDTH = 360;

/** Shortest side at or above this is a tablet or an unfolded foldable. */
const TABLET_WIDTH = 700;

/** Pill height of the floating tab bar at fontScale 1 — see FloatingTabBar. */
const TAB_BAR_HEIGHT = 56;

/** Width the Discover action rail reserves on the right of a feed card. */
export const RAIL_WIDTH = 52;

/**
 * Horizontal padding for a screen body. Tightens on small phones, and on wide
 * screens grows so the column stays `CONTENT_MAX` and lands centred — cheaper
 * and less invasive than wrapping every screen in a max-width container.
 */
export function gutterFor(width: number): number {
  const base = width < COMPACT_WIDTH ? spacing.lg : spacing.xl;
  const centering = (width - CONTENT_MAX) / 2;
  return centering > base ? centering : base;
}

/**
 * Space a scrolling screen leaves free so its last row clears the floating tab
 * bar. Mirrors the bar's own geometry: `max(bottomInset, 14) + 4` offset plus
 * the pill, which the OS font scale stretches (capped — past ~1.4 the bar stops
 * growing because its label is capped too).
 */
function clearanceFor(
  bottomInset: number,
  fontScale: number,
  // Annotated: `spacing` is `as const`, so an inferred default narrows to `32`.
  extra: number = spacing.xxl,
): number {
  const scale = Math.min(Math.max(fontScale, 1), 1.4);
  return Math.max(bottomInset, 14) + 4 + TAB_BAR_HEIGHT * scale + extra;
}

/**
 * Card heights that must not swallow a short screen (landscape phone, a folded
 * cover display). Keeps the designed height wherever there is room for it.
 */
export function cardHeightFor(windowHeight: number, designed: number, min: number): number {
  return Math.max(min, Math.min(designed, windowHeight * 0.45));
}

/** Screen metrics + the derived gutter. Re-reads on rotation and on fold. */
export function useLayout() {
  const { width, height, fontScale } = useWindowDimensions();
  return {
    width,
    height,
    fontScale,
    gutter: gutterFor(width),
    landscape: width > height,
    compact: width < COMPACT_WIDTH,
    tablet: Math.min(width, height) >= TABLET_WIDTH,
  };
}

/** Bottom padding that clears the floating tab bar at any font scale. */
export function useTabBarClearance(extra?: number): number {
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  return clearanceFor(insets.bottom, fontScale, extra);
}
