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
 * **Name the provider.** "Our AI" does not satisfy Apple's third-party-AI
 * disclosure rule, and it is not what a person needs to know to decide whether
 * to upload a private chat. Keep this wording in step with `analyzer.tsx`,
 * `ai-consent.tsx`, and §4 of `/privacy` — four surfaces describing one pipe,
 * and a reviewer who finds them disagreeing has found a reason to look harder
 * at all four.
 *
 * This is the standing notice, not the gate. Apple's 5.1.2(i) affirmative
 * action lives in `ai-consent.tsx` behind `utils/useAiConsent.ts`, which every
 * tool calls before its credit gate. That fires once; this stays on screen.
 *
 * Not rendered on the native chat bubble's path — that reply is generated
 * natively and never launches the app, so neither this nor the consent gate can
 * reach it. It is disclosed by `analyzer.tsx`, which is mandatory before the
 * bubble can exist; wiring the consent flag through would mean extending
 * ChatEntitlement in `modules/profile-capture`.
 */
export function AiNotice() {
  return (
    <View style={styles.row}>
      <Ionicons name="cloud-upload-outline" size={13} color={palette.textTertiary} />
      <Text style={styles.text} maxFontSizeMultiplier={1.4}>
        Sent to Google Gemini to write your result, then discarded. Never saved, never posted.
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
