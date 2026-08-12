import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { palette, radii, spacing, type as typo } from '@/theme/tokens';
import type { AnalysisResult } from '@/types';

/**
 * The message the engine is answering, shown before the answers.
 *
 * This is the product's strongest claim and it used to be a 15px grey block
 * sandwiched between the result header and the replies. Every competitor
 * produces a reply out of nowhere; this one quotes the line it read first, so
 * the user can check the model understood before judging what it wrote. That is
 * worth the top of the screen, at `reply` scale, on its own surface.
 *
 * Absent on mock seeds (`read` is optional), so the caller must null-check —
 * demo mode has nothing real to quote and inventing a quote would be a lie told
 * by the one component whose whole job is being verifiable.
 */
export function TheRead({ read }: { read: NonNullable<AnalysisResult['read']> }) {
  const fromThem = read.lastFrom === 'them';

  return (
    <Animated.View
      entering={FadeInDown.springify().damping(17)}
      style={styles.card} 
      accessibilityLabel={`${fromThem ? 'They said' : 'You said'}: ${read.lastMessage}. ${read.thread}`}
    >
      <View style={styles.head}>
        <View style={[styles.tick, !fromThem && styles.tickYou]} />
        <Text style={styles.label} maxFontSizeMultiplier={1.3}>
          {fromThem ? 'THEY SAID' : 'YOU SAID'}
        </Text>
      </View>

      <Text style={styles.quote}>{`“${read.lastMessage}”`}</Text>
      <Text style={styles.thread}>{read.thread}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surfaceHigh,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  // A short rule rather than the old full-height left border: the quote is now
  // the largest text on the screen and does not need a second thing shouting.
  tick: {
    width: 18,
    height: 2,
    borderRadius: 1,
    backgroundColor: palette.violetBright,
  },
  tickYou: {
    backgroundColor: palette.textTertiary,
  },
  label: {
    ...typo.overline,
    color: palette.violetBright,
  },
  quote: {
    ...typo.reply,
  },
  thread: {
    ...typo.caption,
    color: palette.textTertiary,
  },
});
