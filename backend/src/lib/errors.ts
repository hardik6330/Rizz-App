/** Uniform error envelope. The client branches on `code`, never on the message. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

export const Errors = {
  unauthorized: () => new ApiError(401, 'UNAUTHORIZED', 'Invalid or expired token'),
  /*
   * ── The account-existence errors ───────────────────────────────────────────
   *
   * These three SAY which half of the guess was right, and that is a deliberate
   * reversal. The uniform answer that used to be here was correct security
   * advice and a bad product: `/otp` mailed nothing for a signup into a taken
   * address and still answered ok, so a user who typed an address they already
   * had an account with waited for a code that was never sent, on a screen that
   * told them to check their inbox. There is no wording that fixes that — only
   * telling them the account exists does.
   *
   * What still bounds enumeration: the IP token bucket in app.ts (`/v1/auth/*`,
   * 4 tokens refilling at 0.02/s — roughly one probe every 50 seconds per
   * address), the per-account lockout, and the fact that neither the password
   * nor the mailbox is any easier to guess for knowing the address is real.
   */
  emailTaken: () =>
    new ApiError(409, 'EMAIL_TAKEN', 'That email already has an account — log in instead'),
  /**
   * Its own code so the client can point at the username field rather than
   * printing a sentence under the form and leaving the user to work out which
   * of the three inputs is wrong.
   *
   * Enumeration is a much smaller question here than for `emailTaken`: a
   * username is public — the app prints it back as `@name` on the account
   * screen — so confirming one exists reveals nothing the account screen does
   * not, and there is no inbox behind it to attack.
   */
  usernameTaken: () =>
    new ApiError(409, 'USERNAME_TAKEN', 'That username is taken — try another'),
  noAccount: () =>
    new ApiError(404, 'NO_ACCOUNT', 'No account uses that email — create one instead'),
  wrongPassword: () =>
    new ApiError(401, 'WRONG_PASSWORD', 'That password is wrong — or get in with an emailed code'),
  accountLocked: () =>
    new ApiError(
      429,
      'ACCOUNT_LOCKED',
      'Too many wrong passwords. Wait 15 minutes, or log in with an emailed code',
      true,
    ),
  outOfCredits: () => new ApiError(402, 'OUT_OF_CREDITS', 'No analyses left'),
  banned: () => new ApiError(403, 'BANNED', 'This install is blocked'),
  badRequest: (m: string) => new ApiError(400, 'BAD_REQUEST', m),
  rateLimited: () => new ApiError(429, 'RATE_LIMITED', 'Slow down', true),
  aiUnavailable: () => new ApiError(503, 'AI_UNAVAILABLE', 'The engine is unavailable', true),
};
