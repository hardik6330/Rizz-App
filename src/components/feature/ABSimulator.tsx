import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  LinearTransition,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { duration } from '@/theme/motion';
import { palette, radii, spacing, type as typo } from '@/theme/tokens';
import type { ReplyOption, SimThread } from '@/types';
import { haptic } from '@/utils/haptics';
import { HapticPressable } from '@/components/ui/HapticPressable';

interface ABSimulatorProps {
  replies: ReplyOption[];
  sims: SimThread[];
}

/**
 * A/B Response Simulator — expander that plays out the probable reaction
 * to reply A vs reply B as a simulated iMessage thread.
 */
export function ABSimulator({ replies, sims }: ABSimulatorProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(0);
  const chevron = useSharedValue(0);

  const toggle = () => {
    haptic.light();
    chevron.value = withSpring(open ? 0 : 1, { damping: 16 });
    setOpen((value) => !value);
  };

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevron.value * 180}deg` }],
  }));

  const sim = sims[selected] ?? sims[0];
  const reply =
    replies.find((option) => option.id === sim?.replyId) ?? replies[selected] ?? replies[0];

  if (!sim || !reply) return null;

  return (
    <Animated.View layout={LinearTransition.springify().damping(18)} style={styles.card}>
      <HapticPressable
        feedback="none"
        onPress={toggle}
        accessibilityLabel="Toggle A/B response simulator"
        accessibilityState={{ expanded: open }}
        style={styles.header}
      >
        <View style={styles.headerIcon}>
          <Ionicons name="git-branch-outline" size={18} color={palette.violetBright} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title}>A/B Response Simulator</Text>
          <Text style={styles.subtitle}>Preview how they&apos;ll probably reply</Text>
        </View>
        <Animated.View style={chevronStyle}>
          <Ionicons name="chevron-down" size={18} color={palette.textSecondary} />
        </Animated.View>
      </HapticPressable>

      {open && (
        <Animated.View entering={FadeIn.duration(duration.quick)} style={styles.body}>
          {/* A/B selector */}
          <View style={styles.segments}>
            {sims.slice(0, 2).map((thread, index) => {
              const option = replies.find((r) => r.id === thread.replyId) ?? replies[index];
              const active = index === selected;
              const letter = index === 0 ? 'A' : 'B';
              return (
                <HapticPressable
                  key={thread.replyId}
                  feedback="none"
                  accessibilityLabel={`Simulate reply ${letter}`}
                  accessibilityState={{ selected: active }}
                  onPress={() => {
                    haptic.selection();
                    setSelected(index);
                  }}
                  style={[styles.segment, active && styles.segmentActive]}
                >
                  <Text style={[styles.segmentLetter, active && { color: palette.violetBright }]}>
                    {letter}
                  </Text>
                  <Text
                    style={[styles.segmentLabel, active && { color: palette.textPrimary }]}
                    numberOfLines={1}
                  >
                    {option?.style ?? 'Reply'}
                  </Text>
                </HapticPressable>
              );
            })}
          </View>

          {/* Simulated thread — remounts per selection so the animation replays */}
          <ThreadPreview key={sim.replyId} reply={reply} sim={sim} />

          <Text style={styles.disclaimer}>
            Simulated with the RizzCoach behavioral model. Results may cause butterflies.
          </Text>
        </Animated.View>
      )}
    </Animated.View>
  );
}

function ThreadPreview({ reply, sim }: { reply: ReplyOption; sim: SimThread }) {
  const [showResponses, setShowResponses] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowResponses(true), 1350);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.thread}>
      <View style={styles.probRow}>
        <View style={styles.probChip}>
          <Ionicons name="pulse" size={11} color={palette.mint} />
          <Text style={styles.probText}>~{sim.probability}% likely outcome</Text>
        </View>
      </View>

      <ChatBubble from="you" text={reply.text} delay={60} />

      {showResponses ? (
        sim.messages.map((message, index) => (
          <ChatBubble
            key={`${sim.replyId}-${index}`}
            from={message.from}
            text={message.text}
            delay={140 * index}
          />
        ))
      ) : (
        <TypingIndicator />
      )}
    </View>
  );
}

function ChatBubble({ from, text, delay }: { from: 'you' | 'them'; text: string; delay: number }) {
  const isYou = from === 'you';
  return (
    <Animated.View
      entering={FadeInDown.delay(delay).springify().damping(16)}
      style={[styles.bubble, isYou ? styles.bubbleYou : styles.bubbleThem]}
    >
      <Text style={[styles.bubbleText, !isYou && { color: palette.textPrimary }]}>{text}</Text>
    </Animated.View>
  );
}

function TypingIndicator() {
  return (
    <Animated.View entering={FadeIn.duration(duration.quick)} style={[styles.bubble, styles.bubbleThem, styles.typing]}>
      {[0, 1, 2].map((index) => (
        <TypingDot key={index} index={index} />
      ))}
    </Animated.View>
  );
}

function TypingDot({ index }: { index: number }) {
  const opacity = useSharedValue(0.25);
  const reduced = useReducedMotion();

  useEffect(() => {
    /*
     * Reduce Motion holds the dots VISIBLE, not at the sequence's end value.
     *
     * `ReduceMotion.System` jumps a `withRepeat` to its final value, and this
     * sequence ends on `0.25` — so all three dots parked at quarter opacity and
     * the "typing" indicator read as an empty box rather than as something
     * happening. Full opacity is a static typing indicator, which is the
     * conventional reduced-motion form of exactly this control.
     */
    if (reduced) {
      opacity.value = 1;
      return;
    }
    opacity.value = withDelay(
      index * 170,
      withRepeat(
        withSequence(withTiming(1, { duration: 320 }), withTiming(0.25, { duration: 320 })),
        -1,
      ),
    );
  }, [index, opacity, reduced]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.dot, style]} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.surface,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  headerIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${palette.violet}1F`,
    borderWidth: 1,
    borderColor: `${palette.violet}44`,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...typo.body,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  subtitle: {
    ...typo.caption,
    color: palette.textTertiary,
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  segments: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: 10,
    borderRadius: radii.md,
    backgroundColor: palette.surfaceHigh,
    borderWidth: 1,
    borderColor: palette.hairline,
  },
  segmentActive: {
    borderColor: `${palette.violet}88`,
    backgroundColor: `${palette.violet}1F`,
  },
  segmentLetter: {
    ...typo.label,
    fontWeight: '900',
    color: palette.textTertiary,
  },
  segmentLabel: {
    ...typo.label,
    color: palette.textSecondary,
  },
  thread: {
    backgroundColor: palette.ink,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  probRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 2,
  },
  probChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radii.full,
    backgroundColor: `${palette.mint}14`,
    borderWidth: 1,
    borderColor: `${palette.mint}3D`,
  },
  probText: {
    ...typo.micro,
    fontWeight: '700',
    letterSpacing: 0.3,
    color: palette.mint,
  },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    borderRadius: 18,
  },
  bubbleYou: {
    alignSelf: 'flex-end',
    backgroundColor: '#0A84FF',
    borderBottomRightRadius: 5,
  },
  bubbleThem: {
    alignSelf: 'flex-start',
    backgroundColor: '#26262E',
    borderBottomLeftRadius: 5,
  },
  bubbleText: {
    ...typo.body,
    color: '#FFFFFF',
  },
  typing: {
    flexDirection: 'row',
    gap: 4,
    paddingVertical: 12,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: palette.textSecondary,
  },
  disclaimer: {
    ...typo.micro,
    fontWeight: '400',
    letterSpacing: 0,
    color: palette.textTertiary,
    textAlign: 'center',
  },
});
