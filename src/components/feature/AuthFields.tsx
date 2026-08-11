import Ionicons from '@expo/vector-icons/Ionicons';
import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { HapticPressable } from '@/components/ui/HapticPressable';
import { palette, radii, spacing } from '@/theme/tokens';
import { haptic } from '@/utils/haptics';

/**
 * The input halves of `account.tsx` — the credentials form and the code step.
 *
 * Lifted out because that screen was one ~730-line function holding eleven
 * `useState`s and four jobs at once. These two are pure: they render fields and
 * call back, and own no state beyond what is handed to them.
 *
 * They live in `components/`, NOT beside the screen: `src/app/` is the Expo
 * Router tree, so a non-route file dropped in there becomes a navigable route.
 *
 * The screen keeps the shell — hero copy, tabs, error row, CTA, footnote —
 * because every one of those reads three or more flags at once (`isSignup`,
 * `step`, `useCode`, `isOnboarding`) and pulling them out would mean passing all
 * four down to render one line of text.
 */

type FieldProps = React.ComponentProps<typeof TextInput> & {
  label: string;
  accessory?: React.ReactNode;
};

export function Field({ label, accessory, ...input }: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel} maxFontSizeMultiplier={1.3}>
        {label}
      </Text>
      <View style={styles.inputRow}>
        <TextInput
          {...input}
          accessibilityLabel={label}
          placeholderTextColor={palette.textTertiary}
          // Merged, not replaced. `style` sits after the spread so it wins, which
          // meant a caller passing one had it silently dropped — the code field's
          // whole point is the tracking and the 26pt face.
          style={[styles.input, input.style]}
        />
        {accessory}
      </View>
    </View>
  );
}

/** Username (signup only), email, and password (unless logging in with a code). */
export function CredentialFields({
  isSignup,
  useCode,
  username,
  onUsername,
  email,
  onEmail,
  password,
  onPassword,
  reveal,
  onToggleReveal,
  onToggleUseCode,
  onSubmit,
}: {
  isSignup: boolean;
  useCode: boolean;
  username: string;
  onUsername: (v: string) => void;
  email: string;
  onEmail: (v: string) => void;
  password: string;
  onPassword: (v: string) => void;
  reveal: boolean;
  onToggleReveal: () => void;
  onToggleUseCode: () => void;
  onSubmit: () => void;
}) {
  return (
    <>
      {isSignup && (
        <Field
          label="USERNAME"
          value={username}
          onChangeText={onUsername}
          placeholder="yourname"
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="username"
          maxLength={32}
        />
      )}

      <Field
        label="EMAIL"
        value={email}
        onChangeText={onEmail}
        placeholder="you@example.com"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        maxLength={255}
      />

      {/* No password field on the recovery path — there is nothing to type there,
          and showing a disabled one would only suggest the user is supposed to
          remember something. */}
      {!useCode && (
        <Field
          label="PASSWORD"
          value={password}
          onChangeText={onPassword}
          placeholder={isSignup ? 'At least 10 characters' : 'Your password'}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry={!reveal}
          // `newPassword` lets the OS keychain offer to generate and save one,
          // which is still the best outcome available: a mailed code gets you back
          // IN, but nothing resets this.
          textContentType={isSignup ? 'newPassword' : 'password'}
          maxLength={128}
          onSubmitEditing={onSubmit}
          returnKeyType="go"
          accessory={
            <HapticPressable
              feedback="none"
              hitSlop={10}
              onPress={onToggleReveal}
              accessibilityLabel={reveal ? 'Hide password' : 'Show password'}
            >
              <Ionicons
                name={reveal ? 'eye-off-outline' : 'eye-outline'}
                size={18}
                color={palette.textTertiary}
              />
            </HapticPressable>
          }
        />
      )}

      {/* The recovery switch, and the single most important control on this screen
          for anyone who has forgotten a password. Placed directly under the
          password field, which is where they are already looking when they
          realise they cannot fill it in. */}
      {!isSignup && (
        <HapticPressable
          feedback="none"
          onPress={() => {
            haptic.selection();
            onToggleUseCode();
          }}
          accessibilityRole="button"
          style={styles.linkRow}
        >
          <Ionicons
            name={useCode ? 'key-outline' : 'mail-outline'}
            size={14}
            color={palette.violetBright}
          />
          <Text style={styles.linkAccent}>
            {useCode ? 'Use my password instead' : 'Forgot your password? Email me a code'}
          </Text>
        </HapticPressable>
      )}
    </>
  );
}

/** Step two: the six digits we mailed, plus the two ways out of it. */
export function CodeStep({
  code,
  onCode,
  busy,
  onSubmit,
  onBack,
  onResend,
}: {
  code: string;
  onCode: (v: string) => void;
  busy: boolean;
  onSubmit: () => void;
  onBack: () => void;
  onResend: () => void;
}) {
  return (
    <>
      <Field
        label="6-DIGIT CODE"
        value={code}
        // Digits only, and never longer than six. Pasting from a mail client drags
        // whitespace and the odd stray character in with it, and the server takes
        // exactly six digits or nothing.
        onChangeText={(t) => onCode(t.replace(/\D/g, '').slice(0, 6))}
        placeholder="123456"
        keyboardType="number-pad"
        // The whole reason iOS offers to fill this from the notification without
        // the user opening the mail at all.
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        autoFocus
        maxLength={6}
        onSubmitEditing={onSubmit}
        returnKeyType="go"
        style={styles.codeInput}
      />

      <View style={styles.codeActions}>
        {/* Back, not a router pop — the form is still mounted with everything
            typed still in it, so a wrong address costs one tap and a correction
            rather than the whole form again. */}
        <HapticPressable
          feedback="none"
          onPress={onBack}
          accessibilityLabel="Change email address"
          style={styles.linkRow}
        >
          <Ionicons name="chevron-back" size={14} color={palette.textSecondary} />
          <Text style={styles.linkText}>Wrong email?</Text>
        </HapticPressable>

        <HapticPressable
          feedback="none"
          disabled={busy}
          onPress={onResend}
          accessibilityLabel="Resend the code"
          style={styles.linkRow}
        >
          <Ionicons name="refresh" size={14} color={palette.textSecondary} />
          <Text style={styles.linkText}>Resend code</Text>
        </HapticPressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  field: { gap: 7 },
  fieldLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, color: palette.textTertiary },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: palette.surfaceHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: palette.hairlineStrong,
  },
  input: { flex: 1, minWidth: 0, paddingVertical: 14, fontSize: 15, color: palette.textPrimary },

  codeInput: { textAlign: 'center', fontSize: 26, fontWeight: '800', letterSpacing: 10 },
  codeActions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  linkText: { fontSize: 13, fontWeight: '700', color: palette.textSecondary },
  linkAccent: { fontSize: 13, fontWeight: '700', color: palette.violetBright },
});
