/**
 * WCAG AA contrast guard for the palette.
 *
 * Run: node src/theme/contrast.selfcheck.ts
 *
 * This reads tokens.ts as TEXT rather than importing it. `tokens.ts` imports
 * `react-native`, which Node cannot parse — the same constraint that leaves
 * `layout.ts` without a selfcheck. Regexing six hex literals out of one file is
 * cheap; duplicating the palette into an import-free module would rot silently
 * the first time someone edits only one copy.
 *
 * Why this exists: `textTertiary` shipped at 3.19:1 on `surfaceHigh` while
 * carrying 12px body copy and TextInput placeholders. That is a Play Store
 * accessibility finding, and nothing in the type system or in `tsc` can see it.
 * The failure mode is a designer picking a pleasing grey — it needs arithmetic.
 *
 * Only TEXT colours are checked. `violetDeep` (2.33:1) is deliberately absent
 * from FOREGROUNDS: it is exclusively a gradient stop in the tab bar, paywall
 * and LockOverlay. WCAG does not apply to decoration. If it ever becomes text,
 * add it here and it will fail, which is the point.
 */
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('./tokens.ts', import.meta.url), 'utf8');

/** Pull `name: '#RRGGBB'` out of the palette block. */
function token(name: string): string {
  const match = new RegExp(`${name}:\\s*'(#[0-9a-fA-F]{6})'`).exec(src);
  if (!match) throw new Error(`token ${name} not found in tokens.ts — renamed?`);
  return match[1];
}

/** Relative luminance, per WCAG 2.1. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/* Every surface a text colour can land on. surfaceHigh is the worst case. */
const SURFACES = ['ink', 'surface', 'surfaceHigh', 'surfaceInset'] as const;

/*
 * 4.5 for anything used as normal-size text. All three text tokens qualify:
 * textTertiary is 12–12.5px, so it does NOT get the 3:1 large-text allowance.
 *
 * The accents are here because they are used for labels and scores, not only for
 * fills — `violet` sits at 4.01:1 on surfaceHigh, so it is held to the large-text
 * bar and must not be used for small copy.
 */
const FOREGROUNDS: [name: string, min: number][] = [
  ['textPrimary', 4.5],
  ['textSecondary', 4.5],
  ['textTertiary', 4.5],
  ['violet', 3], // large/bold only — see note above
  ['violetBright', 4.5],
  ['pink', 4.5],
  ['ember', 4.5],
  ['gold', 4.5],
  ['mint', 4.5],
  ['cyan', 4.5],
  ['danger', 4.5],
];

const failures: string[] = [];

for (const [fg, min] of FOREGROUNDS) {
  for (const bg of SURFACES) {
    const r = ratio(token(fg), token(bg));
    if (r < min) failures.push(`${fg} on ${bg}: ${r.toFixed(2)}:1 < ${min}:1`);
  }
}

/*
 * textTertiary must stay visually distinguishable from textSecondary, or the
 * fix for the contrast failure is "make every grey the same grey" and the type
 * hierarchy quietly dies. 1.2 is the smallest gap that still reads as a step.
 */
const step = luminance(token('textSecondary')) / luminance(token('textTertiary'));
if (step < 1.2) {
  failures.push(`textSecondary/textTertiary collapsed: ${step.toFixed(2)}x apart, want >= 1.2x`);
}

if (failures.length > 0) {
  console.error('FAIL — palette contrast:');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log(`OK — ${FOREGROUNDS.length} text colours clear WCAG AA on all ${SURFACES.length} surfaces`);
