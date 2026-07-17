-- Use this after your first Supabase Auth user exists.
-- Replace the values below before running it in Supabase SQL Editor.

insert into public.organizations (name, slug)
values ('Brizuela Leads', 'brizuela-leads')
on conflict (slug) do update
set name = excluded.name,
    updated_at = now();

insert into public.organization_members (organization_id, profile_id, role, status)
select
  org.id,
  profile.id,
  'SUPER_ADMIN',
  'active'
from public.organizations org
join public.profiles profile on lower(profile.email) = lower('YOUR_ADMIN_EMAIL_HERE')
where org.slug = 'brizuela-leads'
on conflict (organization_id, profile_id) do update
set role = excluded.role,
    status = excluded.status;
