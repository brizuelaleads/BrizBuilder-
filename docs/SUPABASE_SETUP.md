# Supabase setup for BrizBuilder

This is the backend foundation for making BrizBuilder operational with a real database, real users, client isolation, file storage, and future website assets.

## What I added

- Supabase JavaScript SDK.
- Server-side Supabase helpers.
- A backend switch so BrizBuilder can use Supabase for the CRM dashboard.
- A health endpoint at `/api/supabase/status`.
- A baseline Postgres snapshot in `supabase/schema.sql` and authoritative,
  ordered production changes in `supabase/migrations`.
- Row-level security rules so clients cannot see other clients' data.
- Storage buckets for client assets, website assets, and imports.

## Step 1: Create the database tables

In Supabase:

1. Open your Supabase project.
2. Go to **SQL Editor**.
3. Open `supabase/schema.sql` from this repo.
4. Paste the whole file into Supabase.
5. Click **Run**.
6. Open and run each of these files, one at a time, in this exact order:

```txt
supabase/migrations/20260718170000_phone_system.sql
supabase/migrations/20260718210000_connections_and_visual_workflows.sql
supabase/migrations/20260721170000_remove_stored_twilio_balances.sql
supabase/migrations/20260721190000_google_business_profiles.sql
supabase/migrations/20260722040000_google_business_oauth_credentials.sql
```

`supabase/schema.sql` is the baseline copy of
`20260717150000_brizbuilder_initial_schema.sql`; do not run both on a fresh
database. The later dated migrations are required. In particular, the final
two create the Google Business Profile table and the server-only encrypted
OAuth credential table.

If you use the Supabase CLI instead of the SQL Editor, apply the complete
`supabase/migrations` directory to an empty database and skip `schema.sql`.
Whichever method you choose, migrations must run in filename order.

## Step 2: Add environment variables to your host

In Cloudflare/Vercel, add these variables:

```txt
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-secret-key
```

Newer Supabase projects may label these as a **publishable key** and a
**secret key**. The app also supports:

```txt
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
SUPABASE_SECRET_KEY=your-secret-key
SUPABASE_DATABASE_URL=postgresql://postgres.your-project-ref:your-database-password@aws-0-us-east-1.pooler.supabase.com:6543/postgres
BRIZBUILDER_BACKEND=supabase
```

Important: `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_SECRET_KEY` are private.
Never paste real secret values into GitHub.

For Cloudflare Workers, use Supabase's **Transaction pooler** connection
string for `SUPABASE_DATABASE_URL`. If the database password has special
characters, percent-encode the password before saving it.

## Drizzle ORM for Supabase Postgres

BrizBuilder now has a separate Drizzle/Postgres lane for Supabase. The current
live dashboard still uses Cloudflare D1 while Supabase migration work continues.

Use these commands for Supabase/Postgres ORM work:

```bash
npm run db:pg:generate
npm run db:pg:push
npm run db:pg:studio
```

This uses:

- `drizzle.supabase.config.ts`
- `drizzle/supabase/schema.ts`
- `lib/supabase/drizzle.ts`

Because the Supabase connection uses the transaction pooler, the Postgres
client is configured with `prepare: false`.

## Step 3: Test the connection

After deploying, open:

```txt
/api/supabase/status
```

If everything is connected, it will say:

```txt
Supabase is connected and the BrizBuilder schema is reachable.
```

## Step 4: Create the first admin user

Use Supabase Auth to create your main login user. The schema automatically creates a row in `profiles` when the Supabase Auth user exists.

After the user exists:

1. Open `supabase/first-admin-template.sql`.
2. Replace `YOUR_ADMIN_EMAIL_HERE` with your login email.
3. Run it in Supabase SQL Editor.

The first agency organization should be **Brizuela Leads**, and your profile should have the `SUPER_ADMIN` or `AGENCY_OWNER` role.

## Current note

The dashboard now has a Supabase backend lane. Set `BRIZBUILDER_BACKEND=supabase`
in Cloudflare to make Supabase the preferred CRM backend. D1 remains as a
fallback during the migration so the live dashboard does not go down if a
Supabase setting is wrong.

Connected now:

- Admin dashboard bootstrap.
- Clients.
- Contacts.
- Leads and pipeline movement.
- Tasks.
- Appointments.
- Notes.
- Companies.
- Audit events.

Still intentionally staged for the next phase:

- Supabase Auth-based client invitations.
- CSV imports.
- Custom fields/custom values.
- Contact-to-company relationship links.
