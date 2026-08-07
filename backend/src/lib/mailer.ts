import nodemailer, { type Transporter } from 'nodemailer';

import { env } from '../env.ts';
import { ApiError } from './errors.ts';
import { log } from './logger.ts';
import { OTP_TTL_MS } from './otp.ts';

/**
 * The one thing this service sends email for: a six-digit code.
 *
 * Deliberately not a template system, not a queue and not a "notifications"
 * module. There is exactly one message, it has no links, no images and no
 * unsubscribe (it is transactional, and a code the user just asked for is not
 * marketing), and the day a second message exists is the day this file earns a
 * second function — not before.
 *
 * `nodemailer` is the one new dependency. Node has no SMTP client in its
 * standard library, and the alternative is 200 lines of hand-rolled AUTH +
 * STARTTLS + line-ending handling in front of a credential — the exact code you
 * do not want to be the author of.
 */

/**
 * Built once, lazily.
 *
 * Lazily because on a serverless target most invocations never send anything,
 * and a transport opened at import time in a lambda that only serves
 * `/v1/ai/*` is setup nobody asked for. Once, because the object is reusable and
 * rebuilding it per send throws away nothing but also gains nothing.
 *
 * Not pooled. A pool amortises the TCP + TLS + AUTH handshake across queued
 * messages, and there is never a queue here — one code, sent while a user waits.
 * On the serverless target the instance would usually die before the second send
 * anyway. `pool: true` if this ever grows a real send volume.
 */
let transport: Transporter | null = null;

function mailer(): Transporter | null {
  /*
   * All three, not just the host. env.ts already rejects a partial set at boot,
   * so this can only be the all-blank case — but it is also what narrows the
   * types from `string | undefined` for the config below, which is worth more
   * than the redundancy costs.
   */
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) return null;

  transport ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    /*
     * The port picks the encryption mode, because those are the two real
     * choices and pairing them wrong is the classic SMTP misconfiguration:
     *
     *   465 → `secure: true`  — TLS from the first byte (implicit TLS/SMTPS)
     *   587 → `secure: false` — plaintext connect, then upgraded by STARTTLS
     *
     * `secure: false` does NOT mean unencrypted here: nodemailer still issues
     * STARTTLS and, with `requireTLS`, refuses to send if the server will not
     * upgrade. Without that flag a server that quietly omits STARTTLS gets the
     * password in the clear — and this connection carries one on every send.
     */
    secure: env.SMTP_PORT === 465,
    requireTLS: env.SMTP_PORT !== 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    // Beyond this the user has given up and asked for another code anyway, and
    // an SMTP call that hangs holds a request (and on Vercel, a whole function
    // invocation) open until the platform kills it.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return transport;
}

/**
 * Stated in the email because a code with no visible clock reads as broken.
 *
 * DERIVED from the value the server actually enforces, never typed twice. A
 * hardcoded 10 here is correct until somebody tunes `OTP_TTL_MS`, and then it is
 * an email confidently promising a window the code does not have — the kind of
 * wrong that nothing fails on and nobody notices except the user.
 *
 * Safe direction of import: otp.ts does not import this file (the route calls
 * both), so there is no cycle.
 */
const TTL_MINUTES = Math.round(OTP_TTL_MS / 60_000);

/** The app's own violet. Kept in step with `palette.violet` in src/theme/tokens.ts. */
const BRAND = '#5B2EDD';
const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif`;

/**
 * Both bodies, from one code. Plain text is NOT optional: a transactional mail
 * with an HTML part and no text part scores badly with spam filters, and this is
 * the one message in the product that must not land in spam.
 *
 * ## Why this looks like 2004 HTML
 *
 * Because email clients do. Outlook on Windows renders through **Word**, not a
 * browser: no flexbox, no grid, no `max-width` on a div, and `margin` on a block
 * element is unreliable. So the layout is nested tables with `role="presentation"`
 * (which keeps screen readers from announcing them as data tables), spacing lives
 * in `<td style="padding">`, and every style is inline. Gmail strips `<style>`
 * blocks in enough situations — clipped messages, forwards, the mobile apps —
 * that nothing load-bearing may live in one; the only thing in ours is the
 * dark-mode media query, which is pure enhancement.
 *
 * No remote images, and that is a decision rather than an omission: images are
 * blocked by default in most clients, so anything they carry is invisible to a
 * first-time reader, and fetching one is a read receipt the user never agreed
 * to. The wordmark is therefore text — which also means it renders at any DPI.
 *
 * The code panel degrades on purpose. `letter-spacing` is ignored by Word, so
 * the digits stay legible on their own weight and size rather than depending on
 * it; and if the panel's background is stripped, a 34px bold monospace number is
 * still obviously the thing you came for.
 */
function body(code: string, purpose: 'signup' | 'login'): { subject: string; text: string; html: string } {
  const heading = purpose === 'signup' ? 'Confirm your email' : 'Sign in to RizzCoach';
  const what =
    purpose === 'signup'
      ? 'finish creating your RizzCoach account'
      : 'sign in to your RizzCoach account';
  /**
   * The grey line the inbox shows after the subject.
   *
   * Left out, clients fill it with whatever text comes first — here "Confirm
   * your email", so the list would read "Confirm your email · Confirm your
   * email". Putting the code in it means the whole job can be done from the
   * notification, without opening anything.
   */
  const preheader = `Your code is ${code}. It expires in ${TTL_MINUTES} minutes.`;

  return {
    // The code in the subject line: most people read it off the notification and
    // never open the mail. It also makes every message's subject unique, which
    // stops Gmail collapsing consecutive codes into one thread — where the
    // newest is hidden under "show trimmed content" and people read the old one.
    subject: `${code} is your RizzCoach code`,
    text: [
      `RIZZCOACH`,
      ``,
      `${heading}`,
      ``,
      `Your code is: ${code}`,
      ``,
      `Enter it in the app to ${what}. The code expires in ${TTL_MINUTES} minutes and can only be used once.`,
      ``,
      `Didn't request this? Ignore this email — nothing has changed, and nobody can`,
      `use this code without it. Never share it with anyone, including RizzCoach staff.`,
      ``,
      `--`,
      `This is an automated message, so replies aren't monitored.`,
    ].join('\n'),
    html: `<!doctype html>
<html lang="en" style="margin:0;padding:0">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<!-- Tells a client this message has a dark rendering of its own, so it uses the
     media query below instead of auto-inverting our colours into mud. -->
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${heading}</title>
<style>
  /* Enhancement only. Apple Mail and iOS honour this; Gmail ignores it and
     keeps the light version, which is why the light version is the real one. */
  @media (prefers-color-scheme: dark) {
    .bg   { background:#0A0A12 !important; }
    .card { background:#13131E !important; border-color:#2A2A3D !important; }
    .h    { color:#F7F7FA !important; }
    .p    { color:#A2A2B5 !important; }
    .muted{ color:#7E7E92 !important; }
    .panel{ background:#1B1B2A !important; border-color:#3A2A6B !important; }
    .code { color:#F7F7FA !important; }
    .rule { border-color:#2A2A3D !important; }
  }
  /* Under 480px the card padding is most of the screen. */
  @media only screen and (max-width:480px) {
    .pad  { padding-left:24px !important; padding-right:24px !important; }
    .code { font-size:30px !important; letter-spacing:6px !important; }
  }
</style>
</head>
<body class="bg" style="margin:0;padding:0;background:#F2F2F6;-webkit-font-smoothing:antialiased">

<!-- Preheader: pulled into the inbox preview, invisible in the body itself.
     The zero-width joiners stop clients padding the preview with the text that
     follows it. -->
<div style="display:none;font-size:1px;color:#F2F2F6;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${preheader}&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg" style="background:#F2F2F6">
  <tr>
    <td align="center" style="padding:32px 12px">

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;width:100%">

        <!-- Wordmark. Text, not an image — see the note on this function. -->
        <tr>
          <td align="center" style="padding:0 0 20px">
            <span style="font-family:${FONT};font-size:15px;font-weight:800;letter-spacing:2px;color:${BRAND};text-transform:uppercase">Rizz<span style="color:#8B5CF6">Coach</span></span>
          </td>
        </tr>

        <tr>
          <td class="card" style="background:#FFFFFF;border:1px solid #E4E4ED;border-radius:14px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">

              <tr>
                <td class="pad" style="padding:36px 40px 0">
                  <h1 class="h" style="margin:0 0 10px;font-family:${FONT};font-size:22px;line-height:28px;font-weight:700;color:#12121C">${heading}</h1>
                  <p class="p" style="margin:0;font-family:${FONT};font-size:15px;line-height:23px;color:#55556B">Enter this code in the app to ${what}.</p>
                </td>
              </tr>

              <!-- The code. Monospace so 0/O and 1/l cannot be misread when
                   someone types it back in by hand. -->
              <tr>
                <td class="pad" style="padding:24px 40px 0">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="panel" style="background:#F6F3FF;border:1px solid #E0D7FF;border-radius:10px">
                    <tr>
                      <td align="center" style="padding:22px 12px">
                        <div class="code" style="font-family:'SF Mono',SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace;font-size:34px;line-height:40px;font-weight:700;letter-spacing:9px;color:#12121C;text-indent:9px">${code}</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <tr>
                <td class="pad" style="padding:16px 40px 0">
                  <p class="muted" style="margin:0;font-family:${FONT};font-size:13px;line-height:20px;color:#7A7A90">Expires in ${TTL_MINUTES} minutes, and works once.</p>
                </td>
              </tr>

              <tr>
                <td class="pad" style="padding:24px 40px 0">
                  <div class="rule" style="border-top:1px solid #ECECF3;font-size:0;line-height:0">&nbsp;</div>
                </td>
              </tr>

              <!-- The security note. Standard for a reason: the one thing that
                   actually defeats a code sent to the right person is talking
                   them into reading it out. -->
              <tr>
                <td class="pad" style="padding:20px 40px 36px">
                  <p class="muted" style="margin:0 0 8px;font-family:${FONT};font-size:13px;line-height:20px;color:#7A7A90">Didn&rsquo;t request this? Ignore this email &mdash; nothing has changed, and the code is useless without it.</p>
                  <p class="muted" style="margin:0;font-family:${FONT};font-size:13px;line-height:20px;color:#7A7A90"><strong style="color:#55556B">Never share this code</strong>, with anyone, including anyone claiming to be from RizzCoach.</p>
                </td>
              </tr>

            </table>
          </td>
        </tr>

        <tr>
          <td align="center" class="pad" style="padding:20px 24px 0">
            <p class="muted" style="margin:0;font-family:${FONT};font-size:12px;line-height:18px;color:#9797A8">This is an automated message, so replies aren&rsquo;t monitored.</p>
          </td>
        </tr>

      </table>

    </td>
  </tr>
</table>
</body>
</html>`,
  };
}

/**
 * Send a code, or fail the request.
 *
 * Awaited by the route rather than fired and forgotten, and that is the whole
 * design: if the mail did not go, the user must be told NOW. A green "check your
 * inbox" over a message that never left is a user staring at an empty mailbox
 * with no idea whether to wait or retry, and — since a code is the only way to
 * finish signing up — no way into the product at all.
 *
 * Never logs the address or the code. Same rule as lib/logger.ts.
 */
export async function sendOtpEmail(
  to: string,
  code: string,
  purpose: 'signup' | 'login',
): Promise<void> {
  const t = mailer();

  /*
   * No SMTP configured — development only; env.ts refuses to boot production
   * without it, and refuses a partial set anywhere. Printing the code is what
   * makes the whole flow exercisable against a laptop with no mail server, and
   * it is loud on purpose.
   */
  if (!t) {
    log.warn('mail.disabled', { purpose, code, note: 'SMTP_HOST/USER/PASS unset — code NOT emailed' });
    return;
  }

  const { subject, text, html } = body(code, purpose);
  try {
    await t.sendMail({
      /*
       * Blank MAIL_FROM means "send as the account itself", which is both the
       * right default and mandatory on Gmail — it rewrites any other From to the
       * authenticated address anyway.
       *
       * Wrapped in a display name rather than sent bare: an inbox row reading
       * `no-reply@…` next to a subject containing a login code is what a
       * phishing attempt looks like, and the sender name is the first thing
       * anyone checks before trusting one.
       */
      from: env.MAIL_FROM ?? `RizzCoach <${env.SMTP_USER}>`,
      to,
      subject,
      text,
      html,
      headers: {
        /*
         * RFC 3834. Tells out-of-office autoresponders and ticketing systems not
         * to reply to this — without it a user with a vacation responder mails
         * the sending mailbox back for every code, and on a shared address that
         * is a support queue filling with nothing.
         */
        'Auto-Submitted': 'auto-generated',
      },
    });
    log.info('mail.sent', { purpose });
  } catch (err) {
    log.error('mail.failed', err, { purpose });
    /*
     * Retryable, and phrased as our fault because it is. The user cannot fix a
     * bad SMTP password by re-typing their address, and "check your email is
     * correct" would send them off to debug the one thing that is fine.
     */
    throw new ApiError(502, 'MAIL_FAILED', 'Could not send the code — try again in a moment', true);
  }
}
