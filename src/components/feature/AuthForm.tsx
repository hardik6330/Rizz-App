import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { CodeStep, CredentialFields } from '@/components/feature/AuthFields';
import { HapticPressable } from '@/components/ui/HapticPressable';
import type { AuthFormState } from '@/hooks/useAuthForm';
import { palette, radii, spacing } from '@/theme/tokens';

/**
 * The signup/login form — hero copy, tabs, fields, error and the one CTA.
 *
 * Purely the rendering half of `useAuthForm`, which owns every piece of state
 * behind it. Split out of `account.tsx` so that screen is left with the thing it
 * is actually about: deciding whether to show this, the signed-in panel, or the
 * offline notice.
 *
 * There is exactly one place the auth copy lives, and it is here. That matters
 * more than usual: this product still has **no password reset**. What it has is
 * a mailed code that logs you in without one, and both halves of that have to be
 * said where the user goes looking — on the signup warning and on the login form.
 */
export function AuthForm({ form, isOnboarding }: { form: AuthFormState; isOnboarding: boolean }) {
  const { isSignup, step, useCode, wantsCode, busy, error, email } = form;

  /* Three labels from two flags. On the form step of a code path the button
     sends the code and does NOT create anything — calling it "Create account"
     there would be a lie about what the tap does, and the moment a user believes
     the account exists is the moment they stop looking for the email. */
  const ctaLabel = wantsCode && step === 'form' ? 'Send code' : isSignup ? 'Create account' : 'Log in';
  const ctaIcon =
    wantsCode && step === 'form' ? 'mail-outline' : isSignup ? 'sparkles' : 'log-in-outline';

  return (
    <>
      <Animated.View entering={FadeInDown.springify().damping(18)} style={styles.hero}>
        <Text style={styles.title} maxFontSizeMultiplier={1.25}>
          {step === 'code'
            ? 'Check your email.'
            : !isSignup
              ? 'Welcome back.'
              : isOnboarding
                ? 'Welcome to RizzCoach.'
                : 'Keep your credits.\nWherever you install.'}
        </Text>
        <Text style={styles.body}>
          {step === 'code' ? (
            <>
              {/* The address is echoed back because the commonest failure here is
                  a typo the user cannot see any more — the field is a screen
                  behind them. Reading it back turns "no email arrived" into "ah,
                  that's wrong" without a Back tap. */}
              We sent a 6-digit code to <Text style={styles.strong}>{email.trim()}</Text>. It expires
              in 10 minutes.
            </>
          ) : isSignup ? (
            isOnboarding ? (
              'Create an account so your free analyses, Pro status and saved lines belong to you — not to this one phone. Already have one? Log in.'
            ) : (
              'Your analyses live on this device today. An account moves them to you, so a new phone or a reinstall picks up where you left off.'
            )
          ) : useCode ? (
            // A plain string, so the entity has to be the real character —
            // `&rsquo;` only decodes in JSX text, never inside a literal.
            'Enter your email and we’ll send you a code. No password needed.'
          ) : (
            'Log in and your credits, Pro status and history come with you.'
          )}
        </Text>
      </Animated.View>

      {/* Hidden on the code step. Switching tabs there throws away a code that is
          already in the user's inbox and a form they have filled in, for a tap
          they almost certainly meant as "go back". */}
      {step === 'form' && (
        <View style={styles.tabs}>
          {(['signup', 'login'] as const).map((key) => {
            const active = key === form.mode;
            return (
              <HapticPressable
                key={key}
                feedback="none"
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => form.switchMode(key)}
                style={[styles.tab, active && styles.tabActive]}
              >
                {/* minWidth 0 + flexShrink + numberOfLines: RN defaults flexShrink
                    to 0, so a long label spills the gutter. */}
                <Text
                  style={[styles.tabLabel, active && { color: palette.textPrimary }]}
                  numberOfLines={1}
                  maxFontSizeMultiplier={1.2}
                >
                  {key === 'signup' ? 'Create account' : 'Log in'}
                </Text>
              </HapticPressable>
            );
          })}
        </View>
      )}

      {step === 'code' ? (
        <CodeStep
          code={form.code}
          onCode={form.setCode}
          busy={busy}
          onSubmit={() => void form.submit()}
          onBack={form.backToForm}
          onResend={form.resend}
        />
      ) : (
        <CredentialFields
          isSignup={isSignup}
          useCode={useCode}
          username={form.username}
          onUsername={form.setUsername}
          email={email}
          onEmail={form.setEmail}
          password={form.password}
          onPassword={form.setPassword}
          reveal={form.reveal}
          onToggleReveal={form.toggleReveal}
          onToggleUseCode={form.toggleUseCode}
          onSubmit={() => void form.submit()}
        />
      )}

      {error != null && (
        <View style={styles.error} accessibilityLiveRegion="polite">
          <Ionicons name="alert-circle-outline" size={15} color={palette.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <HapticPressable
        feedback="none"
        onPress={() => void form.submit()}
        disabled={busy}
        accessibilityLabel={ctaLabel}
        style={[styles.cta, busy && styles.ctaBusy]}
      >
        {busy ? (
          <ActivityIndicator color={palette.ink} />
        ) : (
          <>
            <Ionicons name={ctaIcon} size={17} color={palette.ink} />
            <Text style={styles.ctaText}>{ctaLabel}</Text>
          </>
        )}
      </HapticPressable>

      <Text style={styles.footnote}>
        We store your email and username, and nothing else about you. Screenshots and conversations
        are never saved.
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  hero: { gap: spacing.sm },
  title: { fontSize: 27, lineHeight: 33, fontWeight: '900', letterSpacing: -0.8, color: palette.textPrimary },
  body: { fontSize: 14.5, lineHeight: 21, color: palette.textSecondary },
  /** Emphasis inside a muted paragraph — the address echoed back on the code step. */
  strong: { fontWeight: '800', color: palette.textPrimary },

  tabs: { flexDirection: 'row', gap: spacing.sm },
  tab: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    paddingVertical: 11,
    borderRadius: radii.full,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.hairline,
  },
  tabActive: { backgroundColor: `${palette.violet}24`, borderColor: `${palette.violet}88` },
  tabLabel: { flexShrink: 1, fontSize: 13.5, fontWeight: '700', color: palette.textSecondary },

  error: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  errorText: { flex: 1, fontSize: 13, lineHeight: 18, color: palette.danger },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: 16,
    borderRadius: radii.full,
    backgroundColor: palette.violetBright,
  },
  ctaBusy: { opacity: 0.7 },
  ctaText: { fontSize: 15.5, fontWeight: '900', color: palette.ink },
  footnote: { fontSize: 12, lineHeight: 17, textAlign: 'center', color: palette.textTertiary },
});
