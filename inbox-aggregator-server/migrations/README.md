# Migrations

The changes made to the original database, in order, each run once by hand in
the Supabase SQL Editor. They're kept as the record of how it reached its
current shape: some are one-off steps for that database's own data (000 only
checks, 004 removes an old column, 005 hands existing accounts to a login), and
the first tables were created before these files began.

**Setting up a new database? Use [`../schema.sql`](../schema.sql) instead.** It
builds the whole current database in one step.

A change to the database from now on gets a new numbered file here (the next is
016) and the same change in `schema.sql`, so both stay in step. Run a migration
before deploying server code that needs it.
