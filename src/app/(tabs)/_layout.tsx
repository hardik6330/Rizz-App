import { Tabs } from 'expo-router/js-tabs';
import React from 'react';

import { AppErrorBoundary } from '@/components/AppErrorBoundary';
import { FloatingTabBar } from '@/components/FloatingTabBar';
import { palette } from '@/theme/tokens';

/**
 * Contains a crash to the tab tree rather than the whole app.
 *
 * The three AI tools render model output directly — a report shape the model
 * got wrong takes down whatever renders it. With only the root boundary, that
 * meant losing the tab bar and the other three tools too. Expo Router uses the
 * NEAREST boundary, so this one answers for anything under `(tabs)` and Retry
 * remounts just this subtree.
 */
export { AppErrorBoundary as ErrorBoundary };

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: palette.ink },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Lab' }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile Scan' }} />
      <Tabs.Screen name="bio" options={{ title: 'Bio Optimizer' }} />
      <Tabs.Screen name="discover" options={{ title: 'Discover' }} />
    </Tabs>
  );
}
