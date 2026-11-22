-- Planned content is scoped to one client. The CRM API checks current
-- membership before every read and write using the service role.
create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  client_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  caption text not null default '' check (char_length(caption) <= 2200),
  channels text[] not null check (channels in (
    array['facebook'], array['instagram'],
    array['facebook', 'instagram'], array['instagram', 'facebook']
  )),
  planned_date date,
  media_url text check (media_url like 'https://%' and char_length(media_url) <= 2000),
  status text not null default 'draft' check (status in (
    'draft', 'in_review', 'changes_requested', 'approved', 'published'
  )),
  review_feedback text check (char_length(btrim(review_feedback)) between 1 and 1000),
  published_at timestamptz,
  revision integer not null default 1 check (revision > 0),
  actor_email text not null,
  updated_at timestamptz not null default now(),
  constraint social_posts_organization_client_fkey foreign key (organization_id, client_id)
    references public.clients(organization_id, id) on delete cascade,
  constraint social_posts_review_content check (
    status in ('draft', 'changes_requested') or btrim(caption) <> '' or media_url is not null
  ),
  constraint social_posts_review_feedback check (
    (status = 'changes_requested') = (review_feedback is not null)
  ),
  constraint social_posts_publication check (
    (status = 'published') = (published_at is not null)
  )
);

create index social_posts_workspace_updated_idx
  on public.social_posts(organization_id, client_id, updated_at desc, id desc);

alter table public.social_posts enable row level security;
revoke all on table public.social_posts from public, anon, authenticated;
grant select, insert, update on table public.social_posts to service_role;

-- Record the actor and transition in the same transaction as the post, without
-- copying captions, feedback, or media URLs into the audit log.
create function public.audit_social_post_change() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.audit_events (
    organization_id, client_id, actor_email, action, record_type, record_id, metadata
  ) values (
    new.organization_id, new.client_id, new.actor_email,
    case
      when tg_op = 'INSERT' then 'social.post.created'
      when old.status is distinct from new.status then 'social.post.' || new.status
      else 'social.post.updated'
    end,
    'social_post', new.id::text, jsonb_build_object('revision', new.revision)
  );
  return new;
end;
$$;

revoke all on function public.audit_social_post_change() from public, anon, authenticated;
grant execute on function public.audit_social_post_change() to service_role;

create trigger social_posts_audit_change
  after insert or update on public.social_posts
  for each row execute function public.audit_social_post_change();
