import * as WebBrowser from 'expo-web-browser';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { HapticPressable } from '@/components/ui/HapticPressable';
import { PRIVACY_URL, TERMS_URL } from '@/constants';
import { palette, spacing, type as typo } from '@/theme/tokens';

/**
 * Terms · Privacy, and whatever else a screen needs beside them.
 *
 * ## Why this is a component and not two more `Linking.openURL` calls
 *
 * `TERMS_URL` and `PRIVACY_URL` had exactly two call sites, both on the paywall.
 * Not on `account.tsx` — which is a MANDATORY signup gate with no way past it —
 * and not on `ai-consent.tsx`.
 *
 * That second gap was the sharp one. The consent screen is where the user
 * affirmatively agrees to send a third party's private messages to an AI
 * provider, and its copy deliberately says "our AI provider" rather than naming
 * Google (see AiNotice.tsx for why that split exists and why the policy half is
 * not optional). §4 of `/privacy` is where the provider IS named — so with no
 * link here, a user who never opened the paywall had **no path at all** to the
 * identity of the company receiving their screenshots. App Store Review 5.1.1(i)
 * also asks for a policy link wherever an account is created.
 *
 * ## Why `openBrowserAsync` and not `Linking.openURL`
 *
 * `Linking` throws the user out to Safari or Chrome and loses the screen they
 * were on — mid-signup, or mid-consent, which is exactly when they are least
 * likely to come back. This opens the same page in-app, over the modal, and
 * closing it returns them where they were.
 */
export function LegalLinks({ children }: { children?: React.ReactNode }) {
  const open = (url: string) => {
    // Failure here is a missing browser, which is not worth an error state on a
    // consent screen — the user is no worse off than before the tap.
    void WebBrowser.openBrowserAsync(url).catch(() => {});
  };

  return (
    <View style={styles.row}>
      <Link label="Terms" onPress={() => open(TERMS_URL)} />
      <Text style={styles.dot}>·</Text>
      <Link label="Privacy" onPress={() => open(PRIVACY_URL)} />
      {children}
    </View>
  );
}

/**
 * Exported so the paywall's "Restore purchases" sits in the same row with the
 * same target, rather than being a third hand-rolled copy of this.
 */
export function Link({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <HapticPressable
      feedback="none"
      /*
       * A caption line box is ~13pt against a 44pt iOS minimum, and one of these
       * is "Restore purchases" — the control Apple expects a subscriber to be able
       * to hit. Vertical slop is free (the row wraps with gap), horizontal is kept
       * small so neighbours in the same row never overlap into ambiguity.
       */
      hitSlop={{ top: 16, bottom: 16, left: 10, right: 10 }}
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}
    >
      <Text style={styles.text}>{label}</Text>
    </HapticPressable>
  );
}

/** The separator between two links. Exported so callers can add their own. */
export function Dot() {
  return <Text style={styles.dot}>·</Text>;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  text: {
    ...typo.caption,
    fontWeight: '600',
    color: palette.textTertiary,
  },
  dot: {
    ...typo.caption,
    color: palette.textTertiary,
  },
});
