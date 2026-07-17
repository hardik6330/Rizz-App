/**
 * Higgsfield-generated visual assets.
 *
 * Backgrounds: FLUX.2 — dark cinematic mesh gradients (9:16).
 * Avatars: Higgsfield Soul 2.0 — realistic persona portraits (1:1).
 * Regenerate via the prompts documented in README.md.
 */

export const BG = {
  violet: require('@/assets/generated/bg-violet.jpg'),
  ember: require('@/assets/generated/bg-ember.jpg'),
  teal: require('@/assets/generated/bg-teal.jpg'),
} as const;

export const AVATARS = {
  maya: require('@/assets/generated/avatar-maya.jpg'),
  marcus: require('@/assets/generated/avatar-marcus.jpg'),
  zara: require('@/assets/generated/avatar-zara.jpg'),
  kai: require('@/assets/generated/avatar-kai.jpg'),
} as const;

/** Gradient fallbacks matching each generated background's mood. */
export const BG_FALLBACK: Record<keyof typeof BG, [string, string, string]> = {
  violet: ['#2A1B5E', '#151030', '#0A0A12'],
  ember: ['#5E1B2A', '#301015', '#0A0A12'],
  teal: ['#0F3A4A', '#0C1F30', '#0A0A12'],
};
