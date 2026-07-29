import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { palette, spacing } from '@/theme/tokens';

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
    fontSize: 44,
    lineHeight: 52,
  },
  title: {
    fontSize: 19,
    fontWeight: '800',
    color: palette.textPrimary,
  },
  link: {
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  linkText: {
    fontSize: 15,
    fontWeight: '700',
    color: palette.violetBright,
  },
});
