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
  /**
   * Wrong password OR no such email — deliberately indistinguishable. Splitting
   * these tells an attacker which half of the guess was right, and with no
   * password reset a taken account is taken for good.
   */
  invalidCredentials: () => new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password'),
  outOfCredits: () => new ApiError(402, 'OUT_OF_CREDITS', 'No analyses left'),
  banned: () => new ApiError(403, 'BANNED', 'This install is blocked'),
  badRequest: (m: string) => new ApiError(400, 'BAD_REQUEST', m),
  rateLimited: () => new ApiError(429, 'RATE_LIMITED', 'Slow down', true),
  aiUnavailable: () => new ApiError(503, 'AI_UNAVAILABLE', 'The engine is unavailable', true),
};
