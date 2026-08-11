import { StyleSheet } from 'react-native';

import { absoluteFill, glow, palette, radii, spacing, type } from '@/theme/tokens';

/** The one stylesheet for all four welcome demos. Shared keys (phone, captionBox,
 *  sparkle, resultBar…) are why it is one module and not four. */
export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.ink },
  pager: { flex: 1 },
  page: { flex: 1 },

  kicker: { ...type.overline, color: palette.violetBright, marginBottom: spacing.sm },
  title: { ...type.hero },
  body: { ...type.bodyMuted },
  copy: { marginTop: spacing.lg, gap: spacing.sm + 2 },

  // A wrapping row of chips rather than a stacked list: three of these cost one
  // line instead of three, and the height that buys goes to the visual above.
  // Wrapping is allowed rather than reserved for — the spacer below absorbs the
  // difference, so a page whose facts take two rows does not shift the visual.
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  fact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: palette.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairline,
    borderRadius: radii.full,
    paddingLeft: spacing.sm,
    paddingRight: spacing.md - 2,
    paddingVertical: 5,
  },
  factText: { ...type.caption, fontSize: 11, color: palette.textSecondary },

  cardLabel: { ...type.overline, fontSize: 10, color: palette.textTertiary },
  scoreRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  score: { ...type.hero, fontSize: 30, lineHeight: 34, color: palette.mint },
  scoreOf: { ...type.caption, color: palette.textTertiary },
  badge: {
    marginLeft: 'auto',
    alignSelf: 'center',
    backgroundColor: palette.surfaceHigh,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  badgeText: { ...type.caption, fontSize: 11, color: palette.textSecondary },

  /* ── The Bio Lab demo ──────────────────────────────────────────────────── */

  bioForm: { flex: 1, gap: 6 },
  sectionLabel: { ...type.overline, fontSize: 10, color: palette.textTertiary, marginTop: 2 },
  // Selected state is a background and a border, never a size change — a chip
  // that grew on selection would reflow the whole wrapping grid under the
  // reader every time one lit up.
  chipOn: { backgroundColor: palette.violetDeep, borderColor: palette.violetBright, borderWidth: 1 },
  chipTextOn: { color: palette.textPrimary },
  writing: { marginTop: 'auto' },
  bioResult: { flex: 1, gap: spacing.sm, justifyContent: 'center' },
  toneChip: {
    backgroundColor: palette.violetDeep,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  toneChipText: { ...type.caption, fontSize: 11, color: palette.violetBright },
  bioText: { ...type.body, fontSize: 15, lineHeight: 22 },
  bioActions: { flexDirection: 'row', gap: spacing.sm },
  ghostButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: palette.surfaceHigh,
    borderRadius: radii.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  ghostButtonText: { ...type.caption, fontSize: 12, color: palette.textSecondary },

  /* ── The Lab demo ──────────────────────────────────────────────────────── */

  drop: { flex: 1, gap: spacing.sm },
  // Dashed while empty and solid once filled — the same "put something here"
  // convention as the real `GlowDropZone`, so the affordance the user learns on
  // this page is the one they meet in the app.
  dropZone: {
    flex: 1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: palette.hairlineStrong,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.sm,
    overflow: 'hidden',
  },
  dropZoneFilled: { borderStyle: 'solid', borderColor: palette.violetDeep },
  dropEmpty: { alignItems: 'center', gap: 6 },
  dropHint: { ...type.caption, color: palette.textTertiary },
  shot: { alignSelf: 'stretch', gap: 5 },
  miniBubble: { maxWidth: '80%', borderRadius: radii.sm, paddingHorizontal: 8, paddingVertical: 5 },
  miniTheirs: { alignSelf: 'flex-start', backgroundColor: palette.surfaceHigh },
  miniMine: { alignSelf: 'flex-end', backgroundColor: palette.violet },
  miniText: { ...type.caption, fontSize: 10, color: palette.textSecondary },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 40,
    borderRadius: radii.full,
    backgroundColor: palette.violet,
  },
  // Pressed state is opacity, not scale: the button is full width, and scaling
  // it moves both its edges inward, which reads as the layout shifting rather
  // than as a tap.
  uploadButtonDown: { opacity: 0.75 },
  uploadButtonSpent: { opacity: 0.35 },
  uploadText: { ...type.label, fontSize: 14 },
  uploadRipple: {
    ...absoluteFill,
    borderRadius: radii.full,
    borderWidth: 2,
    borderColor: `${palette.violetBright}66`,
  },
  /*
   * Three replies have to clear the card's 230pt floor, which after `phone`'s
   * padding leaves 198pt of usable height. At `spacing.sm` padding and gaps the
   * stack came to 208 and the third reply — the Bold one, the whole reason to
   * show three — clipped on a small phone. 6pt everywhere brings it to ~192.
   */
  replies: { flex: 1, gap: 6, justifyContent: 'center' },
  reply: {
    backgroundColor: palette.surfaceHigh,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
    gap: 3,
  },
  replyText: { ...type.body, fontSize: 12, lineHeight: 16, color: palette.textSecondary },
  // Three pips always drawn and filled to the level, rather than a variable
  // count — `spice` is a scale, and a scale needs its own maximum on screen to
  // be read as one.
  spice: { flexDirection: 'row', gap: 3, marginLeft: 'auto' },
  pip: { width: 5, height: 5, borderRadius: radii.full, backgroundColor: palette.hairlineStrong },
  pipOn: { backgroundColor: palette.gold },

  /* ── The profile-scan demo ─────────────────────────────────────────────── */

  // Layered on `phone`, which supplies the card frame both demos share. The
  // padding is dropped because the photo is full-bleed here — the copy carries
  // its own inset instead.
  profile: { padding: 0, justifyContent: 'flex-end' },
  // Bottom-weighted like the tour pages' scrim and for the same reason: the
  // name and bio sit at the bottom of the photo, and a flat overlay would mute
  // the whole image to protect one corner of it.
  profileScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: '30%',
    backgroundColor: 'rgba(10,10,18,0.78)',
  },
  profileCopy: { padding: spacing.md, gap: 6 },
  profileName: { ...type.h2, fontSize: 22 },
  profileTag: { ...type.caption, color: palette.textTertiary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  chip: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  chipText: { ...type.caption, fontSize: 11, color: palette.textSecondary },
  profileBio: { ...type.body, fontSize: 13, lineHeight: 19, color: palette.textSecondary },

  /*
   * The app switch. It covers the ENTIRE card rather than sliding up inside it,
   * because a bubble tap on a profile ends in `launchApp()` — RizzCoach comes to
   * the foreground and draws this itself. Compare `result` on the chat demo,
   * which is deliberately a partial cover: that one really is our sheet sitting
   * over someone else's app.
   */
  report: {
    ...absoluteFill,
    backgroundColor: palette.surface,
    paddingHorizontal: spacing.md,
    // Tighter than the horizontal padding on purpose. Stacked up, the bar, two
    // scores with a note each and the opener come to almost exactly the card's
    // 230pt floor, and the vertical padding is the one place to find slack that
    // costs nothing to read.
    paddingVertical: spacing.sm + 2,
    gap: spacing.sm,
  },
  reportMode: { ...type.caption, fontSize: 11, color: palette.textTertiary, marginLeft: 'auto' },
  reportBody: { gap: spacing.sm, flex: 1 },
  scoreLine: { gap: 1 },
  // Two scores, a note each and an opener all have to clear the card's floor
  // height (230pt) without clipping, and the score is the cheapest thing to buy
  // that room from — it is still the biggest number on the sheet.
  reportScore: { fontSize: 22, lineHeight: 26 },
  scoreNote: { ...type.caption, fontSize: 11, color: palette.textTertiary },
  opener: {
    marginTop: 'auto',
    backgroundColor: palette.surfaceHigh,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.violetDeep,
    padding: spacing.sm + 2,
    gap: 4,
  },
  openerBar: { flexDirection: 'row', alignItems: 'center' },

  stages: { flex: 1, justifyContent: 'center', gap: spacing.md },
  stageText: { ...type.body, fontSize: 14, color: palette.textSecondary, textAlign: 'center' },
  // Ticks rather than a filling bar: the work is four discrete passes, and a
  // smooth bar would be inventing a completion percentage nothing measures.
  stageTrack: { flexDirection: 'row', justifyContent: 'center', gap: 5 },
  stageTick: { width: 22, height: 3, borderRadius: radii.full, backgroundColor: palette.hairlineStrong },
  stageTickOn: { backgroundColor: palette.violetBright },

  phone: {
    backgroundColor: palette.surface,
    borderRadius: radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
    padding: spacing.md,
    gap: spacing.md,
    overflow: 'hidden',
  },
  phoneBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: { width: 26, height: 26, borderRadius: radii.full, backgroundColor: palette.surfaceHigh },
  phoneName: { ...type.label },
  online: { width: 6, height: 6, borderRadius: radii.full, backgroundColor: palette.mint },

  /*
   * Fixed height (passed in, derived from the shared visual height) and
   * clipped. The thread is TALLER than this and bottom-aligned, so the oldest
   * messages clip off the top behind the fade — which is what sells it as a
   * conversation already in progress rather than one that starts where the box
   * does. `flex: 1` would defeat that by shrinking the messages to fit.
   */
  thread: { overflow: 'hidden' },
  // Absolutely bottom-anchored rather than laid out with `justifyContent`,
  // because it has to be free to translate DOWN past the box's bottom edge —
  // which is what scrolling back through the history looks like from here.
  threadInner: { position: 'absolute', left: 0, right: 0, bottom: 0, gap: spacing.sm },
  threadFade: { position: 'absolute', top: 0, left: 0, right: 0, height: 40 },
  scanLine: { position: 'absolute', top: 0, left: 0, right: 0, height: 2 },
  // Always drawn, so only the colour animates: toggling borderWidth would
  // reflow each bubble a pixel wider as the scan line reached it.
  scannable: { borderWidth: 1, borderColor: 'rgba(255,255,255,0)' },
  theirBubble: {
    alignSelf: 'flex-start',
    maxWidth: '85%',
    backgroundColor: palette.surfaceHigh,
    borderRadius: radii.lg,
    borderBottomLeftRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  theirText: { ...type.body, fontSize: 14, lineHeight: 20 },
  myBubble: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    backgroundColor: palette.violet,
    borderRadius: radii.lg,
    borderBottomRightRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  myText: { ...type.body, fontSize: 14, lineHeight: 20 },

  composer: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  field: {
    flex: 1,
    minHeight: 40,
    justifyContent: 'center',
    backgroundColor: palette.surfaceHigh,
    borderRadius: radii.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  fieldPlaceholder: { ...type.body, fontSize: 14, color: palette.textTertiary },
  send: {
    width: 34,
    height: 34,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.surfaceHigh,
  },

  /*
   * Our sheet, sitting OVER her composer rather than inside it. The separation
   * is the honest part: the reply lands on the clipboard, not in her app, so
   * the two surfaces must not look like one. Anchored to the card's bottom
   * edge; `overflow: hidden` on `phone` keeps its corners inside the radius.
   */
  result: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: palette.surfaceHigh,
    borderTopWidth: 1,
    borderTopColor: palette.violetDeep,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: 6,
  },
  resultBar: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  resultTitle: { ...type.overline, fontSize: 10, color: palette.violetBright },
  resultText: { ...type.body, fontSize: 14, lineHeight: 19, minHeight: 38 },
  copied: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: `${palette.mint}22`,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  copiedText: { ...type.caption, fontSize: 11, color: palette.mint },

  sparkle: {
    position: 'absolute',
    right: 42,
    bottom: 42,
    width: 40,
    height: 40,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.violetDeep,
    borderWidth: 1,
    borderColor: palette.violetBright,
    ...glow(palette.violet, 0.6, 16),
  },
  sparkleGlyph: { fontSize: 18 },
  ripple: {
    position: 'absolute',
    right: 32,
    bottom: 32,
    width: 60,
    height: 60,
    borderRadius: radii.full,
    borderWidth: 2,
    borderColor: `${palette.violetBright}66`,
  },

  // Holds two lines of body copy. The demo's caption changes every phase and
  // wraps differently at each one, so without a reserved box the facts below it
  // would hop up and down on every beat of the loop.
  captionBox: { minHeight: 44 },

  // Takes up whatever the visual and copy do not, so the copy sits directly
  // under the visual instead of being spread down the page.
  spacer: { flex: 1 },

  // Outside the pager, so the CTA and the dots stay put while the pages move
  // under them. A per-page copy would slide the button off screen mid-swipe.
  footer: { gap: spacing.md, paddingTop: spacing.md },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: radii.full, backgroundColor: palette.hairlineStrong },
  dotOn: { backgroundColor: palette.violetBright, width: 18 },

  cta: {
    height: 54,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: palette.violet,
    ...glow(palette.violet, 0.4, 20),
  },
  ctaText: { ...type.h3, fontSize: 17 },
  footnote: { ...type.caption, color: palette.textTertiary, textAlign: 'center' },
});
