/**
 * Framework-free check for lib/disposable.ts.
 *
 *   node --import tsx src/lib/disposable.selfcheck.ts
 *
 * The failure that matters is not a throwaway inbox slipping through — that
 * costs one free account. It is a FALSE POSITIVE: a real user with a gmail
 * address told their email is temporary, on the mandatory signup gate, with no
 * way past it and no reason to believe the app rather than their inbox. So the
 * allow cases below are the point of this file.
 */
import assert from 'node:assert/strict';

import { isDisposableEmail } from './disposable.ts';

// The providers real people use. Never blocked.
for (const ok of [
  'sam@gmail.com',
  'sam@googlemail.com',
  'sam@outlook.com',
  'sam@hotmail.com',
  'sam@yahoo.com',
  'sam@icloud.com',
  'sam@proton.me',
  'sam@protonmail.com',
  'sam@gmx.com',
  'sam@rizzcoach.app',
  'sam@some-company.co.uk',
]) {
  assert.equal(isDisposableEmail(ok), false, `${ok} must be accepted`);
}

for (const bad of [
  'sam@yopmail.com',
  'sam@mailinator.com',
  'sam@guerrillamail.com',
  'sam@temp-mail.org',
  'sam@10minutemail.com',
]) {
  assert.equal(isDisposableEmail(bad), true, `${bad} must be refused`);
}

// Subdomains resolve to their provider — `mail.yopmail.com` is yopmail.
assert.equal(isDisposableEmail('sam@mail.yopmail.com'), true, 'subdomain of a blocked domain');
// …and a domain that merely ENDS with a blocked one's letters is not it.
assert.equal(isDisposableEmail('sam@notyopmail.com'), false, 'suffix match must be on a label boundary');

// Case is the caller's job — `emailField` lowercases before this runs — but a
// mixed-case address reaching here must not silently pass.
assert.equal(isDisposableEmail('SAM@YOPMAIL.COM'.toLowerCase()), true, 'normalised address is caught');

// A local part containing an @ must not confuse the domain split.
assert.equal(isDisposableEmail('a@b@yopmail.com'), true, 'domain is read from the LAST @');

console.log('disposable.selfcheck: ok');
