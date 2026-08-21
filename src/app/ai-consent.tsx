import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/Button';
import { HapticPressable } from '@/components/ui/HapticPressable';
import { LegalLinks } from '@/components/ui/LegalLinks';
import { track, type EngineName } from '@/services/analytics';
import { useRizzStore } from '@/state/useRizzStore';
import { useLayout } from '@/theme/layout';
import { palette, radii, spacing, type as typo } from '@/theme/tokens';
import { haptic } from '@/utils/haptics';

/**
 * "Your screenshots go to Google." The consent gate in front of every AI tool.
 *
 * **This screen is a compliance surface, like `analyzer.tsx`.** Apple requires an
 * affirmative action before personal data is shared with a third-party AI, and
 * requires the provider to be named — "our AI" does not satisfy it, and neither
 * does a line of small print the user never had to acknowledge. If what the app
 * uploads ever changes, this copy changes in the same commit.
 *
 * Four surfaces describe this one pipe and they must agree: here,
 * `components/AiNotice.tsx`, `analyzer.tsx`, and §4 of `/privacy`. A reviewer who
 * finds them disagreeing has a reason to distrust all four.
 *
 * **There is no "Decline" button, and that is not a dark pattern.** Closing the
 * screen IS declining: the flag stays false, the tool the user came from does
 * nothing, and they land back where they were with everything else still working.
 * A decline button that did exactly that would be a second control for one
 * decision. What would be a dark pattern is pre-ticking the box, hiding the
 * provider's name, or making the app unusable until they agree — none of which
 * this does.
 */
export default function AiConsentScreen() {
  const insets = useSafeAreaInsets();
  const { gutter } = useLayout();
  const grantAiConsent = useRizzStore((state) => state.grantAiConsent);

  /**
   * Which tool sent them here. Only used for funnel attribution — never shown,
   * and never anything about what they were about to upload.
   *
   * Defaulted rather than required: a deep link or a restored navigation state
   * can land here with no param, and an analytics gap is not a reason to fail to
   * render a consent screen.
   */
  const { engine } = useLocalSearchParams<{ engine?: EngineName }>();
  const from: EngineName = engine ?? 'lab';

  useEffect(() => {
    // Arrivals. `ai_consent_seen` fires in the hook, so the difference between
    // the two is people the router dropped on the way here.
    track({ name: 'ai_consent_seen', engine: from });
  }, [from]);

  const accept = () => {
    haptic.success();
    track({ name: 'ai_consent_granted', engine: from });
    grantAiConsent();
    router.back();
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingHorizontal: gutter, paddingBottom: insets.bottom + spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.badge}>
            <Ionicons name="cloud-upload-outline" size={22} color={palette.violetBright} />
          </View>
          <Text style={styles.title} maxFontSizeMultiplier={1.3}>
            Before your first{'\n'}screenshot
          </Text>
          <Text style={styles.sub} maxFontSizeMultiplier={1.4}>
            RizzCoach does not write your replies on your phone. Here is exactly where they come
            from.
          </Text>
        </View>

        <View style={styles.card}>
          {/*
            "Our AI provider" rather than the provider's name — the product copy
            is generic by choice, and §4 of `/privacy` names it. What must NOT be
            softened is the transfer itself: this screen is the affirmative
            consent gate, so it has to say plainly that the upload leaves the
            device and reaches another company. "The only company outside
            RizzCoach that sees it" is carrying that weight now, and is the
            sentence to protect if this is ever shortened.
          */}
          <Bullet
            icon="cloud-upload-outline"
            text="What you upload is sent to our AI provider, which writes the reply, the report or the bio. They are the only company outside RizzCoach that sees it."
          />
          <Bullet
            icon="trash-outline"
            text="It is used to answer that one request and then discarded. Nothing you upload is stored on our servers, and only the results you choose to save are kept."
          />
          {/*
            Named because it is the thing a person is actually weighing: they are
            about to upload someone else's messages. Saying "your data" would be
            technically true and would dodge the point.
          */}
          <Bullet
            icon="chatbubbles-outline"
            text="That includes screenshots of conversations with other people. Only send what you would be comfortable sharing on their behalf."
          />
          <Bullet
            icon="hand-left-outline"
            text="Nothing is ever uploaded on its own. It happens when you pick a screenshot and ask for a result — never in the background."
          />
        </View>

        <Button
          label="I understand — continue"
          icon="checkmark"
          variant="accent"
          onPress={accept}
          accessibilityLabel="Agree and continue"
        />

        {/*
          The exit. Explicit, because a modal with one button and no stated way
          out reads as coercive even when the close gesture works fine.
        */}
        <HapticPressable
          onPress={() => router.back()}
          accessibilityLabel="Not now"
          style={styles.secondary}
        >
          <Text style={styles.secondaryText}>Not now</Text>
        </HapticPressable>

        <Text style={styles.foot} maxFontSizeMultiplier={1.4}>
          Discover and your saved lines keep working either way — they do not upload anything.
        </Text>

        {/*
          The route to the provider's name.

          The bullets above say "our AI provider" on purpose — see AiNotice.tsx for
          why the product copy stays generic. §4 of `/privacy` is where Google's
          Gemini API is named as the sub-processor, and until this link existed the
          paywall was the ONLY screen in the app that reached it. A consent gate the
          user cannot read the policy from is not much of a gate.
        */}
        <LegalLinks />
      </ScrollView>
    </View>
  );
}

function Bullet({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  return (
    <View style={styles.bullet}>
      <Ionicons name={icon} size={15} color={palette.violetBright} style={styles.bulletIcon} />
      <Text style={styles.bulletText} maxFontSizeMultiplier={1.5}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.ink },
  scroll: { gap: spacing.lg, paddingTop: spacing.xl },
  hero: { gap: spacing.sm },
  badge: {
    width: 46,
    height: 46,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${palette.violet}24`,
    borderWidth: 1,
    borderColor: `${palette.violet}55`,
    marginBottom: spacing.xs,
  },
  title: {
    ...typo.h1,
    fontWeight: '900',
  },
  sub: { ...typo.bodyMuted },
  card: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.hairline,
  },
  bullet: { flexDirection: 'row', gap: spacing.sm },
  bulletIcon: { marginTop: 2 },
  bulletText: { ...typo.bodySm, flex: 1 },
  
  secondary: { alignItems: 'center', paddingVertical: spacing.xs },
  secondaryText: { ...typo.label, fontWeight: '600', color: palette.textSecondary },
  foot: { ...typo.caption, fontWeight: '400', textAlign: 'center', color: palette.textTertiary },
});
