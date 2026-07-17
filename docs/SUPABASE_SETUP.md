# Supabase setup for BrizBuilder

This is the backend foundation for making BrizBuilder operational with a real database, real users, client isolation, file storage, and future website assets.

## What I added

- Supabase JavaScript SDK.
- Server-side Supabase helpers.
- A health endpoint at `/api/supabase/status`.
- A production-style Postgres schema in `supabase/schema.sql`.
- Row-level security rules so clients cannot see other clients' data.
- Storage buckets for client assets, website assets, and imports.

## Step 1: Create the database tables

In Supabase:

1. Open your Supabase project.
2. Go to **SQL Editor**.
3. Open `supabase/schema.sql` from this repo.
4. Paste the whole file into Supabase.
5. Click **Run**.

## Step 2: Add environment variables to your host

In Cloudflare/Vercel, add these variables:

```txt
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-secret-key
```

Important: `SUPABASE_SERVICE_ROLE_KEY` is private. Never paste it into GitHub.

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

The app is now ready to connect to Supabase, but the existing dashboard still uses the current database layer until we migrate the CRM screens over. This was done on purpose so the live site does not break while Supabase gets connected.
