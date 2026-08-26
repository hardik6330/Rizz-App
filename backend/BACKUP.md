# Backup

Everything the backend knows lives in one MySQL database on Railway: accounts,
credits, saved items, purchase history. Nothing else stores it. A backup is a copy
of that database in one file.

**There is no automatic backup yet.** Every copy is one someone remembered to take.
Until that changes, take one before anything risky — a migration, a schema change,
a Railway plan change, a credential rotation.

## Take a backup

Needs the MySQL client once: `sudo apt install mariadb-client -y`

Credentials come from `backend/.env` → `DATABASE_URL`:

```
mysql://root:PASSWORD@HOST.proxy.rlwy.net:PORT/railway
        ^user ^password ^host              ^port ^db
```

```sh
mysqldump -h HOST -P PORT -u root -pPASSWORD \
  --single-transaction --quick --no-tablespaces --triggers \
  --default-character-set=utf8mb4 \
  railway > db_backup.sql
```

`--single-transaction` takes a consistent snapshot without blocking writes, so this
is safe to run against the live database.

## Check it before trusting it

```sh
ls -lh db_backup.sql                  # tens of KB, not a few hundred bytes
tail -1 db_backup.sql                 # must read "-- Dump completed on ..."
grep -c 'DROP TABLE' db_backup.sql    # 10 tables
```

A failed dump still creates a file — the error goes to the screen and the file is
left nearly empty. **Never keep a file that fails these three checks.** A tiny dump
looks like a backup right up until the day you need it.

`db_backup.sql` is git-ignored. It contains real user emails and
purchase records — keep it off Slack, off email, and off any machine that is not
yours.

## Restore

The target database must be **empty**, and `db:migrate` must not have run against it.

```sh
mysql -h HOST -P PORT -u root -pPASSWORD \
  --default-character-set=utf8mb4 railway < db_backup.sql
```

Import is a **restore, not a merge** — the dump drops each table first, so whatever
was in the target is gone. Then:

1. Point `backend/.env` `DATABASE_URL` at the new host.
2. `npm run db:migrate` — applies anything generated after the dump was taken.
3. `npm run check:db` — the DB-backed self-checks; they fail loudly if the schema
   or data landed wrong.

Entitlements are the one thing that repairs itself: `syncEntitlementFor` rebuilds
them from RevenueCat, so a stale `users.entitlement` corrects on the user's next
sync. Credits do not — `credit_events` is the ledger, and anything spent after the
dump was taken comes back as unspent.

## Worth knowing

**A backup you have never restored is a guess.** Do one test restore into a spare
Railway database, once, while nothing is wrong.

**Two copies, two places.** A dump sitting next to the laptop that took it survives
mistakes, not hardware.
