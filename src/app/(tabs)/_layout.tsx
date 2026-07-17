import { Tabs } from 'expo-router/js-tabs';
import React from 'react';

import { FloatingTabBar } from '@/components/FloatingTabBar';
import { palette } from '@/theme/tokens';

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
