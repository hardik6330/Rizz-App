import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { glyph, palette, spacing, type as typo } from '@/theme/tokens';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Lost?' }} />
      <View style={styles.container}>
        <Text style={styles.emoji}>👻</Text>
        <Text style={styles.title}>This screen ghosted you.</Text>
        <Link href="/" style={styles.link}>
          <Text style={styles.linkText}>Slide back home</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: palette.ink,
    padding: spacing.xl,
  },
  emoji: {
    fontSize: glyph.xxl,
    lineHeight: 52,
  },
  title: {
    ...typo.h2,
  },
  link: {
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  linkText: {
    ...typo.body,
    fontWeight: '700',
    color: palette.violetBright,
  },
});
