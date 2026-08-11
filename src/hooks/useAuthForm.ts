import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';

import { track } from '@/services/analytics';
import {
  AuthError,
  lastAccountEmail,
  logIn,
  logInWithCode,
  requestOtp,
  signUp,
} from '@/services/auth';
import { haptic } from '@/utils/haptics';

/**
 * The signup/login state machine, lifted whole out of `account.tsx`.
 *
 * It is one machine, not two forms: `mode` (signup | login), `step` (details |
 * code) and `useCode` (password or a mailed code) between them describe every
 * state the screen can be in, and `submit` is the single transition function.
 * That is why it did not want splitting into two routes, and it is also why it
 * belongs behind one interface instead of sixteen `useState` calls sitting in a
 * render body — the screen was carrying the machine, the chrome, the launch gate
 * and two confirm dialogs at once, and no reader could see where one ended.
 *
 * The rendering half is `components/AuthForm.tsx`. **Nothing here touches the
 * signed-in view**; that state belongs to the screen, which decides which of the
 * two to show.
 *
 * `isOnboarding` — is this the mandatory launch gate, or the dismissible modal
 * from the Profile Scan row? It only changes what happens on success (replace
 * the route vs toast) and which hero copy is used, so it is passed in rather
 * than re-derived here.
 */
export type Mode = 'signup' | 'login';

interface Options {
  isOnboarding: boolean;
  /** `useToast().show`. Success and resend feedback both land on the screen's toast. */
  showToast: (message: string) => void;
}

export function useAuthForm({ isOnboarding, showToast }: Options) {
  const { mode: initialMode } = useLocalSearchParams<{ mode?: Mode }>();
  /**
   * The email this device signed in with last, if any.
   *
   * Read once at mount — it only changes as a result of submitting this form,
   * and re-reading it mid-session would swap the field out from under whoever is
   * typing.
   *
   * It used to justify a banner and a rejection. Now it does one quiet thing:
   * pre-fill the LOGIN field, so a returning user does not have to remember
   * which of their addresses they used here. Never the signup field — see below.
   */
  const [remembered] = useState(lastAccountEmail);
  const [mode, setMode] = useState<Mode>(
    // Remembered → open on Log in, because someone who has signed in on this
    // device before is overwhelmingly likely to be doing it again. A default, not
    // a restriction: the Create account tab is right there and now works. An
    // explicit `?mode=` still wins; it comes from a deliberate tap.
    initialMode === 'login' || (initialMode == null && remembered != null) ? 'login' : 'signup',
  );
  const [username, setUsername] = useState('');
  /**
   * Pre-filled on LOGIN only, and blank on signup.
   *
   * The remembered address is by definition one that already has an account, so
   * on the signup tab it can only ever be wrong. That used to be a SILENT dead
   * end — `/otp` answered ok without sending, so the user got "check your email"
   * and waited forever — and `EMAIL_TAKEN` has since fixed the silence. Still
   * blank here, because the best version of that error is the one nobody sees.
   */
  const [email, setEmail] = useState(mode === 'login' ? remembered ?? '' : '');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Details, or the code we emailed. One flag rather than a route.
   *
   * The details are still mounted behind it — going back is `setStep('form')`
   * and nothing else, with the password still typed. A second screen would have
   * meant either passing an unsubmitted password through a navigation param or
   * lifting it into the store, and neither is a thing to do with a password.
   */
  const [step, setStep] = useState<'form' | 'code'>('form');
  const [code, setCode] = useState('');
  /**
   * Log in with a mailed code instead of the password.
   *
   * The nearest thing this product has to a reset, and the reason the code step
   * is worth its complexity: before it, a forgotten password was an account
   * nobody could recover. Login-only — signup always takes the code path.
   */
  const [useCode, setUseCode] = useState(false);

  const isSignup = mode === 'signup';

  /**
   * Does this path end in a code?
   *
   * Signup always does — that is what makes the address real. Login only when
   * the user asked for it, which is the recovery route.
   */
  const wantsCode = isSignup || useCode;

  /** Anything typed on one tab is noise on the other, including a half-done code step. */
  const switchMode = useCallback(
    (next: Mode) => {
      haptic.selection();
      setMode(next);
      setError(null);
      setStep('form');
      setCode('');
      setUseCode(false);
      /*
       * The remembered address follows the tab, and only ever when the field is
       * untouched. Filling it on Log in saves the returning user the one thing they
       * cannot look up; clearing it on Create account keeps them off the silent
       * dead end described on `email`. Guarded on the value being exactly the
       * remembered one (or empty) so it can never overwrite something typed.
       */
      if (remembered == null) return;
      setEmail((current) => {
        if (next === 'login') return current === '' ? remembered : current;
        return current === remembered ? '' : current;
      });
    },
    [remembered],
  );

  /** Back from the code step to the details, which are still mounted behind it. */
  const backToForm = useCallback(() => {
    setStep('form');
    setCode('');
    setError(null);
  }, []);

  /**
   * The address is real, but it is on the wrong tab.
   *
   * `EMAIL_TAKEN` on signup and `NO_ACCOUNT` on login are the same mistake seen
   * from either side, and the fix is always "you wanted the other tab". Moving
   * there for the user is the whole point of the server naming these cases: the
   * error text alone leaves them to find a tab they have already scrolled past,
   * and re-type an address they just typed.
   *
   * `setMode`, not `switchMode` — that one clears the form and would take the
   * email with it, which is the one thing that must survive this.
   */
  const nudgeMode = useCallback((failureCode: string) => {
    if (failureCode !== 'EMAIL_TAKEN' && failureCode !== 'NO_ACCOUNT') return;
    setMode(failureCode === 'EMAIL_TAKEN' ? 'login' : 'signup');
    setUseCode(false);
    setStep('form');
    setCode('');
  }, []);

  /**
   * Send (or resend) the code, and move to the code step.
   *
   * Shared by the CTA and the Resend button. `announce` is set only by Resend:
   * the first send changes the whole screen, which is feedback enough, but a
   * resend leaves the user on the same screen looking at the same field, and a
   * button that appears to do nothing is a button people tap five times.
   *
   * The copy is now a plain "Code sent" — a 2xx from `/otp` means the mail
   * really went out. It used to be hedged ("if that address has an account")
   * because the server answered ok either way; it no longer does.
   */
  const sendCode = useCallback(
    async (announce = false) => {
      const mail = email.trim();
      setBusy(true);
      setError(null);
      try {
        /* The username rides along on signup so the server can reject a taken
           name here, while the user is still looking at the field, rather than
           from the INSERT after they have typed the code. */
        await requestOtp(mail, isSignup ? 'signup' : 'login', isSignup ? username.trim() : undefined);
        haptic.success();
        setStep('code');
        if (!announce) return;
        showToast('Code sent — check your inbox and spam');
      } catch (err) {
        haptic.warning();
        if (err instanceof AuthError) nudgeMode(err.code);
        setError(err instanceof AuthError ? err.message : 'Could not send the code — try again');
      } finally {
        setBusy(false);
      }
    },
    [email, isSignup, nudgeMode, showToast, username],
  );

  const resend = useCallback(() => {
    setCode('');
    void sendCode(true);
  }, [sendCode]);

  const submit = useCallback(async () => {
    if (busy) return;
    setError(null);

    // Client-side mirrors of the server's Zod rules. Without these a rejected
    // field costs a round trip and reads as "the app is broken".
    if (isSignup && !/^[a-z0-9_]{3,32}$/i.test(username.trim())) {
      setError('Username: 3–32 characters, letters, numbers and _ only');
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError('That email does not look right');
      return;
    }
    if (isSignup && password.length < 10) {
      setError('Password must be at least 10 characters');
      return;
    }
    // Only the password paths need one. A code login has no password to check,
    // and demanding one there would shut the recovery route to the exact people
    // it exists for.
    if (!wantsCode && !password) {
      setError('Enter your password');
      return;
    }

    /*
     * Step one of two: the details check out, so mail a code and stop here.
     *
     * Everything typed stays mounted behind the code step, so "wrong email"
     * costs a Back and not a retype.
     */
    if (wantsCode && step === 'form') {
      haptic.medium();
      await sendCode();
      return;
    }

    if (wantsCode && !/^\d{6}$/.test(code.trim())) {
      setError('Enter the 6-digit code from your email');
      return;
    }

    haptic.medium();
    setBusy(true);
    try {
      if (isSignup) {
        await signUp({
          username: username.trim(),
          email: email.trim(),
          password,
          code: code.trim(),
        });
      } else if (useCode) {
        await logInWithCode(email.trim(), code.trim());
      } else {
        await logIn(email.trim(), password);
      }
      /*
       * After the await, so a rejected attempt never counts as a conversion.
       * `method` keeps the three paths apart — in particular the code login,
       * which is this product's only recovery route and is currently assumed
       * rather than known to be used.
       */
      track(
        isSignup
          ? { name: 'account_created', method: 'signup' }
          : { name: 'account_login', method: useCode ? 'code' : 'password' },
      );
      haptic.success();
      setPassword('');
      setCode('');
      // `signUp`/`logIn` already pushed the username into the store, which flips
      // the launch gate — `(tabs)` exists as of this render. Replace rather than
      // `back()`: as the gate this screen is the root, there is nothing behind
      // it to pop to. Going to the app also clears it from the history, so the
      // analyzer step waiting behind can present over the tabs and not over a
      // signup form the user has already finished with.
      if (isOnboarding) {
        // Returns while still busy, on purpose — the spinner is what the user
        // looks at for the frames the navigator needs, and this screen is going
        // away, so there is nothing left to un-busy.
        router.replace('/');
        return;
      }
      showToast(isSignup ? 'Account created — your credits are safe now' : 'Welcome back');
    } catch (err) {
      haptic.warning();
      // Same tab nudge as `sendCode`. Reachable here on the password login path,
      // which never touches /otp, and on a signup whose address was claimed in
      // the seconds between the code being sent and this submit.
      if (err instanceof AuthError) nudgeMode(err.code);
      /*
       * A taken username is now refused by `/otp` before a code is ever sent, so
       * reaching it here means somebody claimed the name in the seconds since.
       * Rare, but it strands the user: they are on the code step, the field they
       * have to change is on the form behind it, and the code they typed is
       * burnt either way. So send them back to it — with everything else still
       * filled in, since the details step stays mounted.
       */
      if (err instanceof AuthError && err.code === 'USERNAME_TAKEN') {
        setStep('form');
        setCode('');
      }
      // The server writes these for the user and never quotes what was typed.
      setError(err instanceof AuthError ? err.message : 'Something went wrong — try again');
    }
    // Not `finally`: that also runs on the early return above, which is the one
    // path that must stay busy. A rejected login still lands here.
    setBusy(false);
  }, [busy, code, email, isOnboarding, isSignup, nudgeMode, password, sendCode, showToast, step, useCode, username, wantsCode]);

  return {
    mode,
    isSignup,
    step,
    useCode,
    wantsCode,
    username,
    email,
    password,
    code,
    reveal,
    busy,
    error,
    /** True once the gate has been seen before on this device — drives `gate_seen`. */
    returning: remembered != null,
    setUsername,
    setEmail,
    setPassword,
    setCode,
    toggleReveal: useCallback(() => setReveal((r) => !r), []),
    toggleUseCode: useCallback(() => {
      setUseCode((v) => !v);
      setError(null);
    }, []),
    switchMode,
    backToForm,
    resend,
    submit,
  };
}

export type AuthFormState = ReturnType<typeof useAuthForm>;
