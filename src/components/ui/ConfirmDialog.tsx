import React from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { HapticPressable } from '@/components/ui/HapticPressable';
import { palette, radii, spacing, type as typography } from '@/theme/tokens';

/**
 * The one destructive-confirmation dialog. Four screens had their own copy.
 *
 * Not `Alert.alert`: the native alert renders in the platform palette — white
 * sheet, blue text, ALL-CAPS Android buttons — in the middle of a dark app, and
 * cannot read `tokens.ts` at all. Every caller here deletes a *server* row, so
 * this dialog is the only thing between a mis-tap and data that is gone.
 *
 * Dismissible by the scrim AND by Android back: a confirm the hardware back
 * button ignores is the one people hit twice and confirm anyway. Both are
 * suppressed while `busy` — dismissing a confirmation whose request is already
 * in flight tells the user it did not happen.
 */
export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  busy = false,
}: {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Disables both buttons and spins the danger one. For async confirms. */
  busy?: boolean;
}) {
  const dismiss = () => {
    if (!busy) onCancel();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={dismiss}
    >
      <Pressable style={styles.scrim} accessibilityLabel="Dismiss" onPress={dismiss}>
        {/* Swallows taps so a press inside the card does not dismiss it. */}
        <Pressable style={styles.dialog} onPress={() => {}}>
          <Text style={styles.dialogTitle}>{title}</Text>
          <Text style={styles.dialogBody}>{body}</Text>
          <View style={styles.dialogActions}>
            <HapticPressable
              onPress={onCancel}
              disabled={busy}
              accessibilityLabel="Cancel"
              style={styles.dialogGhost}
            >
              <Text style={styles.dialogGhostText}>Cancel</Text>
            </HapticPressable>
            <HapticPressable
              onPress={onConfirm}
              disabled={busy}
              accessibilityLabel={confirmLabel}
              style={styles.dialogDanger}
            >
              {busy ? (
                <ActivityIndicator size="small" color={palette.danger} />
              ) : (
                <Text style={styles.dialogDangerText}>{confirmLabel}</Text>
              )}
            </HapticPressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    // Darker than the app background so the card reads as lifted off it — a
    // surface-coloured sheet on an ink scrim would just look like a panel.
    backgroundColor: 'rgba(3,3,8,0.72)',
  },
  dialog: {
    alignSelf: 'stretch',
    maxWidth: 400,
    padding: spacing.xl,
    gap: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: palette.surfaceHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
  },
  dialogTitle: { ...typography.h2 },
  dialogBody: { ...typography.bodyMuted },
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  dialogGhost: {
    paddingVertical: 11,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.full,
  },
  dialogGhostText: { ...typography.body, fontWeight: '700', color: palette.textSecondary },
  dialogDanger: {
    paddingVertical: 11,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.full,
    // Tinted rather than solid: destructive, but it is not the action we are
    // steering the user toward, and a solid red fill reads as the primary CTA.
    backgroundColor: `${palette.danger}24`,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: `${palette.danger}66`,
  },
  dialogDangerText: { ...typography.body, fontWeight: '700', color: palette.danger },
});
