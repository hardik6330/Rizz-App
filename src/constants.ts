export const APP_NAME = 'RizzCoach';

/** Free-tier gates. Crossing either one triggers the paywall. */
export const FREE_ANALYSIS_LIMIT = 3;
export const FREE_SWIPE_LIMIT = 10;

/**
 * Served by the API itself — `backend/src/routes/legal.ts`.
 *
 * These pointed at `rizzcoach.app`, which does not exist and returned 404. Two
 * dead links on the purchase screen is an App Store 3.1.2 rejection and a Play
 * listing violation, and it is the kind of thing nobody notices until review
 * does.
 *
 * `vercel.json` rewrites every path to the Hono app, so `/terms` and `/privacy`
 * work on whatever host the API is on. To move to rizzcoach.app, add the domain
 * to the same Vercel project and change these two lines — nothing else.
 */
export const TERMS_URL = 'https://rizz-app-five.vercel.app/terms';
export const PRIVACY_URL = 'https://rizz-app-five.vercel.app/privacy';

/** RevenueCat entitlement identifier that unlocks Pro. */
export const PRO_ENTITLEMENT_ID = 'pro';
