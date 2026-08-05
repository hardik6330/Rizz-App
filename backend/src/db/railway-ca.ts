/**
 * The CA that signs Railway's MySQL certificate, bundled into the source.
 *
 * ## Why this is committed
 *
 * A certificate is not a credential. It carries a PUBLIC key; the matching
 * private key never leaves Railway's server. Publishing it lets anyone VERIFY
 * that database — it lets nobody CONNECT to it. That is why the DB password
 * lives in `DATABASE_URL` (a secret, never in git) and this does not.
 *
 * ## Why it is here instead of in an env var
 *
 * `DATABASE_CA` used to be required configuration, and getting it wrong was the
 * most expensive misconfiguration in the service: `db/client.ts` is evaluated at
 * module load, so a missing or malformed value crashed the function before it
 * served anything. Client-side that reads as four unrelated bugs — all four
 * engines silently serve mock seeds, and the Android bubble toasts "RizzCoach
 * isn't connected yet" — while `/healthz`, which touches no database, stays
 * green. One less env var that can be typo'd is one less way to take the whole
 * API down.
 *
 * It is also the same value on every deploy target, forever, so asking each
 * platform to carry a copy bought nothing.
 *
 * ## When this needs changing
 *
 * MySQL generates this CA once, when the data directory is initialised. It is
 * stable for the life of the database — but a *recreated* Railway MySQL service
 * (new volume, restore-from-scratch) generates a fresh one, and then every
 * connection fails to verify. Two ways out: set `DATABASE_CA` to override this
 * without a deploy, or dump the new one and replace the text below:
 *
 *   openssl s_client -starttls mysql -connect <host>:<port> -showcerts
 *
 * The CA is the LAST certificate in that chain. Note the notAfter below —
 * 2036-07-29. Nothing warns you when it expires.
 *
 * Subject: CN=MySQL_Server_9.4.0_Auto_Generated_CA_Certificate
 * Issued:  2026-08-01   Expires: 2036-07-29
 */
export const RAILWAY_MYSQL_CA = `-----BEGIN CERTIFICATE-----
MIIDBDCCAeygAwIBAgIBATANBgkqhkiG9w0BAQsFADA7MTkwNwYDVQQDDDBNeVNR
TF9TZXJ2ZXJfOS40LjBfQXV0b19HZW5lcmF0ZWRfQ0FfQ2VydGlmaWNhdGUwHhcN
MjYwODAxMDk1MTE5WhcNMzYwNzI5MDk1MTE5WjA7MTkwNwYDVQQDDDBNeVNRTF9T
ZXJ2ZXJfOS40LjBfQXV0b19HZW5lcmF0ZWRfQ0FfQ2VydGlmaWNhdGUwggEiMA0G
CSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCnpER7tMQE9WGc3eqXtFyLuH6P+4yp
yWEbp1abhcp3mXfQy9KAmgoIf0mwQs6xoeKF30tA5HQ63EM8lQiTyJFWag6iQ8ZB
b2Qnu1fWqfQxV5qFr56xA8rpV3o+ysM+zSuq/g1kQAqFdg2SV+tFeESrpQWhRHCz
1Wo3D/zdg3jws+mwzsxOYbF+UVjG4Q8a+nWmJAwyF0Wemng/ZNFRStb73azsVv2L
bo6xPdqeAAkZFxyOiKyQB+nB8/ic3eJxIEbBV0BUFRuiOyClPoqw+K+x1411ku32
rb06eL7UWrBLV4ktmtZxj0+yguFvzA3zB8mu1m1frdbZ8OLssDtmde2dAgMBAAGj
EzARMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAAxFYosexgWC
etyeigJfvh/2Gsne0a94GOIHtFDkf1S4f7YMJOCUKKUJubTfKNaP2cxCZKdNPRLE
L4bbmfqHNkKlLCuxKqCWOq+kh2CBjUhpmK3a2AdqbzoPr3PatIhYG9/QepfK7MOS
TzeMjtKs1TOgHJH9U55uqbKSwsoUe1eTV5I0tbVXUWuzGb54H8UrjIwFaQvJwgKk
8Na4CzQSoXVugiTdbRi3ZddZO1AdHPwscdvDxQ3FgCilEtnG6GJQ9NaGulUZwXYM
jIT9uVAw8rEASSkOS5LsO9miajyREACBZTQq9qALv9FUP9cQqL+yJISRCZRg6RZF
RHxenzBWKZk=
-----END CERTIFICATE-----
`;
