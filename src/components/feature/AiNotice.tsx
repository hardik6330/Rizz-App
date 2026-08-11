import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { palette, spacing } from '@/theme/tokens';

/**
 * The one line that tells the user their screenshot goes to Google.
 *
 * Every AI tool renders this on its input screen. It is the only place outside
 * `analyzer.tsx` — which is Android-only and which most users never open — where
 * the app admits that anything leaves the device, so on iOS it is the ONLY place.
 *
 * It replaces three near-identical copies of a "Never posted, never shared" row,
 * one per tool. That line was not merely thin, it was misleading in the exact
 * direction that matters: a user reading "private, never shared" about a
 * screenshot of someone else's conversation reasonably concludes the analysis
 * happens on their phone. It does not. It happens at Google.
 *
 * ⚠️ **These lines say "our AI provider"; `/privacy` names Google. That split is
 * deliberate, and the policy half is not optional.**
 *
 * Product copy may stay generic — this is the common pattern and it reads better
 * on a screen someone sees every day. The privacy policy may NOT: §4 of
 * `/privacy` in `backend/src/routes/legal.ts` names Google's Gemini API as the
 * sub-processor, the Play Data Safety declaration is built on that same claim,
 * and a policy that omits the actual recipient of the data is a false statement
 * to users and regulators, not a wording preference. If the provider ever
 * changes, that file changes; these lines do not have to.
 *
 * What must survive any rewrite here is the TRANSFER — that the upload leaves
 * this device and goes to another company. That is the fact the consent gate in
 * `ai-consent.tsx` legally rests on and the one a person needs in order to
 * decide whether to upload someone else's conversation. Plain "uses AI" reads as
 * on-device, which is false in precisely the direction that matters, so
 * "provider" is doing real work in that phrase and is not filler.
 *
 * `analyzer.tsx` and `ai-consent.tsx` are the fuller disclosure surfaces and
 * carry the same claim at more length. A reviewer who finds the four disagreeing
 * has found a reason to look harder at all of them.
 *
 * This is the standing notice, not the gate. Apple's 5.1.2(i) affirmative
 * action lives in `ai-consent.tsx` behind `hooks/useAiConsent.ts`, which every
 * tool calls before its credit gate. That fires once; this stays on screen.
 *
 * Not rendered on the native chat bubble's path — that reply is generated
 * natively and never launches the app, so neither this nor the consent gate can
 * reach it. It is disclosed by `analyzer.tsx`, which is mandatory before the
 * bubble can exist; wiring the consent flag through would mean extending
 * ChatEntitlement in `modules/profile-capture`.
 */
/**
 * One line per tool, because one generic line is read once and then never again.
 *
 * They share a deliberate shape — *your thing goes out, comes back as the thing
 * you wanted, and is never kept* — so the three screens feel like one product,
 * while the nouns change so a user who has already read the Lab's line still has
 * a reason to read the Bio Lab's. Naming what you get back is also what makes it
 * read as a description of the feature rather than as a legal warning.
 *
 * **The warmth comes from the return clause ("in your voice", "sound like you"),
 * never from softening the provider.** "Our personalised AI" was considered and
 * rejected: it implies an in-house or on-device model, which the Play Data
 * Safety answer ("shared with third parties: yes") and `/privacy` both
 * contradict — so a user who reads it and later sees either one has been
 * misled, which is the precise feeling this line exists to prevent. Admitting
 * the transfer is what makes "never saved, never shared" credible; a sentence
 * that dodges where the data goes turns the promise after it into marketing.
 * A benefit adjective inside a disclosure reads as spin, so the benefit lives
 * in the outcome instead — where it is also independently true (`prompts.ts`
 * mirrors the user's own voice, and the coach profile shapes it).
 *
 * ⚠️ Each line must keep all three facts, however it is reworded:
 *
 *   1. it goes to **our AI provider** — a third party, off this device. This is
 *      the fact the consent gate legally rests on, and the one a person needs in
 *      order to decide whether to upload someone else's conversation. "Uses AI"
 *      alone reads as on-device, which is false in the direction that matters.
 *   2. it is **never saved**.
 *   3. it is **never shared**.
 */
const LINE = {
  lab: 'Your screenshot goes to our AI provider and comes back as replies in your voice. Never saved, never shared.',
  bio: 'Your interests go to our AI provider and come back as bios that sound like you. Never saved, never shared.',
  scan: 'The profile goes to our AI provider and comes back scored and explained. Never saved, never shared.',
} as const;

export function AiNotice({ tool }: { tool: keyof typeof LINE }) {
  return (
    <View style={styles.row}>
      <Ionicons name="cloud-upload-outline" size={13} color={palette.textTertiary} />
      <Text style={styles.text} maxFontSizeMultiplier={1.4}>
        {LINE[tool]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    // Not `center`: the text wraps to two lines on a narrow device or at a large
    // font scale, and a centred icon then floats beside the middle of the block.
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  text: {
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 16,
    color: palette.textTertiary,
  },
});
