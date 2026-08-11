/**
 * The interest chips offered by Bio Lab.
 *
 * Here rather than inside `(tabs)/bio.tsx` because `welcome.tsx` demos this
 * exact picker before signup, and a retyped copy would drift the first time a
 * chip was renamed — leaving the onboarding advertising a chip the app does not
 * have. Importing the route module instead would drag `BioScreen` and its whole
 * dependency graph onto the cold-start path, since welcome is the first screen
 * rendered on a fresh install.
 *
 * These are the labels that end up in `BioInput.interests`, so they are user-
 * facing strings, not ids.
 */
export const INTERESTS: { emoji: string; label: string }[] = [
  { emoji: '🏔️', label: 'Adventurer' },
  { emoji: '☕', label: 'Coffee Lover' },
  { emoji: '💻', label: 'Tech Geek' },
  { emoji: '📚', label: 'Bookworm' },
  { emoji: '🏋️', label: 'Gym Rat' },
  { emoji: '🎵', label: 'Music Head' },
  { emoji: '🍳', label: 'Foodie' },
  { emoji: '🐶', label: 'Pet Lover' },
];
