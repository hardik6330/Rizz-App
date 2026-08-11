import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { HapticPressable } from '@/components/ui/HapticPressable';
import { deleteAccount, logOut } from '@/services/auth';
import { palette, radii, spacing } from '@/theme/tokens';
import { haptic } from '@/utils/haptics';

/**
 * The signed-in view, and the two destructive actions that hang off it.
 *
 * Sign-out and delete own their own confirm state here rather than in the
 * screen, which is what lets `account.tsx` stop carrying four booleans for
 * dialogs it does not otherwise mention. `ConfirmDialog` renders a `Modal`, so
 * both sit at the end of this component's tree without any layering consequence.
 *
 * **Both confirmations go through the app's own dark sheet, never
 * `Alert.alert`.** The native dialog renders in the platform's light-ish grey
 * with ALL-CAPS buttons, so the one screen where the user is about to do
 * something they cannot undo would be the one screen that stops looking like
 * this app.
 */
export function SignedInPanel({
  username,
  showToast,
}: {
  username: string;
  showToast: (message: string) => void;
}) {
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const doSignOut = () => {
    setConfirmingSignOut(false);
    /*
     * No navigation. `logOut()` clears the store's account, which un-guards
     * `Stack.Protected` in _layout.tsx and removes `(tabs)` — the account screen
     * IS where the router lands, and it is already there.
     *
     * It used to close the modal. That popped to a tab tree being torn down in
     * the same commit, so the user saw the app flash past on the way to a gate
     * the router then had to fall back to.
     */
    logOut();
  };

  const doDelete = async () => {
    setDeleting(true);
    try {
      await deleteAccount();
      haptic.success();
      setConfirmingDelete(false);
      showToast('Account deleted');
    } catch {
      haptic.warning();
      setConfirmingDelete(false);
      showToast('Could not delete your account — try again');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Animated.View entering={FadeInDown.springify().damping(18)} style={styles.signedIn}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={26} color={palette.violetBright} />
        </View>
        <Text style={styles.signedInName} numberOfLines={1}>
          @{username}
        </Text>
        <Text style={styles.body}>
          Your credits and Pro status follow this account. Log in on a new phone and everything comes
          with you.
        </Text>

        <HapticPressable
          onPress={() => {
            haptic.light();
            setConfirmingSignOut(true);
          }}
          accessibilityLabel="Sign out"
          style={styles.secondary}
        >
          <Ionicons name="log-out-outline" size={16} color={palette.textSecondary} />
          <Text style={styles.secondaryText}>Sign out</Text>
        </HapticPressable>

        <HapticPressable
          onPress={() => {
            haptic.light();
            setConfirmingDelete(true);
          }}
          accessibilityLabel="Delete account"
          style={styles.deleteBtn}
        >
          <Ionicons name="trash-outline" size={16} color={palette.danger} />
          <Text style={styles.deleteBtnText}>Delete account</Text>
        </HapticPressable>
      </Animated.View>

      {/* Load-bearing body copy: with no reset flow, signing out without knowing
          the password is how an account is lost for good. */}
      <ConfirmDialog
        visible={confirmingSignOut}
        title="Sign out?"
        body="You’ll need your email and password to get back in. There’s no password reset yet."
        confirmLabel="Sign out"
        onConfirm={doSignOut}
        onCancel={() => setConfirmingSignOut(false)}
      />

      <ConfirmDialog
        visible={confirmingDelete}
        title="Delete your account?"
        body="This is permanent. Your credits, Pro status, saved lines and all account data will be gone — there is no undo."
        confirmLabel="Delete account"
        busy={deleting}
        onConfirm={() => void doDelete()}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  body: { fontSize: 14.5, lineHeight: 21, color: palette.textSecondary },
  signedIn: { alignItems: 'center', gap: spacing.md, paddingTop: spacing.xl },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: `${palette.violet}1F`,
    borderWidth: 1,
    borderColor: `${palette.violet}55`,
  },
  signedInName: { fontSize: 21, fontWeight: '900', letterSpacing: -0.4, color: palette.textPrimary },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    alignSelf: 'stretch',
    marginTop: spacing.lg,
    paddingVertical: 14,
    borderRadius: radii.full,
    backgroundColor: palette.surfaceHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
  },
  secondaryText: { fontSize: 14.5, fontWeight: '700', color: palette.textSecondary },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    alignSelf: 'stretch',
    paddingVertical: 14,
    borderRadius: radii.full,
    backgroundColor: 'rgba(255,92,92,0.08)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,92,92,0.3)',
  },
  deleteBtnText: { fontSize: 14.5, fontWeight: '700', color: palette.danger },
});
