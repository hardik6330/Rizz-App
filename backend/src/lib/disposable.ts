/**
 * Throwaway inbox domains, refused at signup.
 *
 * ## What this blocks, and what it deliberately does not
 *
 * Disposable providers only — yopmail, mailinator, temp-mail and the rest.
 * **Gmail, Outlook, iCloud, Yahoo and Proton are not on this list and must never
 * be**: this is a consumer dating product, so a rule that only accepted
 * corporate addresses would refuse nearly every real user. "Professional" here
 * means "an inbox the person actually keeps", not "an inbox their employer owns".
 *
 * ## Why it is worth having at all
 *
 * The account gate exists so that an uninstall does not reset the free-credit
 * count (see the docblock on `accountStepDone` in `app/_layout.tsx`). A throwaway
 * address defeats that completely — a new inbox is ten seconds of work, so the
 * free tier becomes unlimited for anyone who notices. It also burns a real
 * outbound email per attempt on an address nobody will ever read.
 *
 * ## Why a list and not a dependency
 *
 * The published lists run to 100k+ domains and go stale the week they ship;
 * these ~70 are the providers that actually show up. It is a speed bump, not a
 * wall — anyone determined can register a domain — and the honest failure mode
 * is a new service we have not seen yet, which costs us one free account.
 * Add to the list when one turns up in the users table.
 *
 * Subdomains count: `foo.yopmail.com` is yopmail, so the suffix is matched too.
 */
const DISPOSABLE = new Set([
  '0-mail.com',
  '10minutemail.com',
  '10minutemail.net',
  '20minutemail.com',
  '33mail.com',
  'anonbox.net',
  'armyspy.com',
  'burnermail.io',
  'byom.de',
  'cuvox.de',
  'dayrep.com',
  'discard.email',
  'dispostable.com',
  'dropmail.me',
  'einrot.com',
  'emailondeck.com',
  'emltmp.com',
  'fakeinbox.com',
  'fakemail.net',
  'fleckens.hu',
  'getairmail.com',
  'getnada.com',
  'grr.la',
  'guerrillamail.biz',
  'guerrillamail.com',
  'guerrillamail.de',
  'guerrillamail.info',
  'guerrillamail.net',
  'guerrillamail.org',
  'guerrillamailblock.com',
  'harakirimail.com',
  'inboxbear.com',
  'inboxkitten.com',
  'jetable.org',
  'linshiyouxiang.net',
  'luxusmail.org',
  'mailinator.com',
  'mailinator.net',
  'mail-temporaire.fr',
  'mail7.io',
  'mailcatch.com',
  'maildrop.cc',
  'mailduck.io',
  'mailna.co',
  'mailnesia.com',
  'mailsac.com',
  'mailtemp.info',
  'mailtothis.com',
  'mintemail.com',
  'moakt.com',
  'mohmal.com',
  'mytemp.email',
  'nowmymail.com',
  'objectmail.com',
  'pokemail.net',
  'rhyta.com',
  'sharklasers.com',
  'sofimail.com',
  'spam4.me',
  'spambog.com',
  'spamgourmet.com',
  'temp-mail.io',
  'temp-mail.org',
  'tempail.com',
  'tempinbox.com',
  'tempm.com',
  'tempmail.net',
  'tempmail.plus',
  'tempmailo.com',
  'tempr.email',
  'throwawaymail.com',
  'trashmail.com',
  'trashmail.de',
  'trbvm.com',
  'tvchd.com',
  'vomoto.com',
  'wegwerfmail.de',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
]);

/**
 * Is this address a throwaway inbox?
 *
 * Expects the already-normalised (trimmed, lowercased) address that `emailField`
 * produces — the Set is lowercase and a mixed-case domain would slip straight
 * through otherwise.
 */
export function isDisposableEmail(email: string): boolean {
  const domain = email.slice(email.lastIndexOf('@') + 1);
  if (DISPOSABLE.has(domain)) return true;
  // `mail.yopmail.com` and friends. Walk the labels rather than testing every
  // entry with `endsWith`, so the cost is the depth of the domain, not the list.
  let rest = domain;
  for (let cut = rest.indexOf('.'); cut !== -1; cut = rest.indexOf('.')) {
    rest = rest.slice(cut + 1);
    if (DISPOSABLE.has(rest)) return true;
  }
  return false;
}
