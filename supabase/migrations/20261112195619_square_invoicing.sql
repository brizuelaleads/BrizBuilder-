-- Square invoicing.
--
-- A Square seller account is owned and billed by whoever connects it: one per
-- client business, plus at most one for the agency itself (client_id null),
-- which the agency uses to invoice its own clients. BrizBuilder holds the OAuth
-- tokens encrypted and never takes a cut or holds funds.
--
-- All three tables are server-only: row level security is on with no policies
-- and every grant to anon/authenticated is revoked, matching
-- google_business_credentials and meta_conversion_credentials.

create table if not exists public.square_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Null means the agency's own Square account.
  client_id uuid references public.clients(id) on delete cascade,
  environment text not null,
  merchant_id text not null,
  merchant_name text,
  location_id text,
  location_name text,
  country text,
  currency text,
  scopes text[] not null default '{}',
  access_token_ciphertext text,
  access_token_iv text,
  refresh_token_ciphertext text,
  refresh_token_iv text,
  access_token_expires_at timestamptz,
  status text not null default 'connected',
  last_error text,
  last_health_check_at timestamptz,
  connected_by_email text not null,
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint square_connections_environment_check
    check (environment in ('sandbox', 'production')),
  constraint square_connections_status_check
    check (status in ('connected', 'attention', 'revoked', 'disconnected')),
  -- A live link always carries both tokens; a closed one carries neither.
  constraint square_connections_tokens_check
    check (
      (status in ('connected', 'attention')
        and access_token_ciphertext is not null and access_token_iv is not null
        and refresh_token_ciphertext is not null and refresh_token_iv is not null)
      or (status in ('revoked', 'disconnected')
        and access_token_ciphertext is null and access_token_iv is null
        and refresh_token_ciphertext is null and refresh_token_iv is null)
    ),
  constraint square_connections_organization_client_fk
    foreign key (organization_id, client_id)
    references public.clients(organization_id, id)
    on delete cascade
);

-- One connection per business, and one for the agency.
create unique index if not exists square_connections_client_uidx
  on public.square_connections(organization_id, client_id)
  where client_id is not null;
create unique index if not exists square_connections_agency_uidx
  on public.square_connections(organization_id)
  where client_id is null;
-- A Square account is linked to one place at a time, so a webhook for a
-- merchant can only ever belong to one tenant scope.
create unique index if not exists square_connections_active_merchant_uidx
  on public.square_connections(environment, merchant_id)
  where disconnected_at is null;

create table if not exists public.square_authorization_states (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  state_hash text not null unique,
  requested_by_email text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint square_authorization_states_organization_client_fk
    foreign key (organization_id, client_id)
    references public.clients(organization_id, id)
    on delete cascade
);
create index if not exists square_authorization_states_expiry_idx
  on public.square_authorization_states(expires_at);

create table if not exists public.square_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.square_connections(id) on delete cascade,
  -- The business that issued the invoice; null when the agency issued it.
  client_id uuid references public.clients(id) on delete cascade,
  -- Agency invoices only: the client business being billed.
  billed_client_id uuid references public.clients(id) on delete set null,
  -- Client invoices only: the contact being billed.
  contact_id uuid references public.contacts(id) on delete set null,
  environment text not null,
  merchant_id text not null,
  recipient_name text not null,
  recipient_email text not null,
  title text not null,
  message text,
  line_items jsonb not null,
  amount_cents bigint not null,
  amount_paid_cents bigint not null default 0,
  currency text not null,
  due_date date not null,
  status text not null default 'draft',
  square_invoice_id text unique,
  square_order_id text,
  square_customer_id text,
  square_version integer,
  invoice_number text,
  public_url text,
  attachment_name text,
  attachment_bytes integer,
  last_error text,
  created_by_email text not null,
  sent_at timestamptz,
  paid_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint square_invoices_environment_check
    check (environment in ('sandbox', 'production')),
  -- Square's invoice states, plus 'failed' for one that never reached Square.
  constraint square_invoices_status_check
    check (status in (
      'draft', 'unpaid', 'scheduled', 'partially_paid', 'paid',
      'partially_refunded', 'refunded', 'canceled', 'failed',
      'payment_pending'
    )),
  constraint square_invoices_amounts_check
    check (amount_cents > 0 and amount_paid_cents >= 0),
  constraint square_invoices_line_items_check
    check (jsonb_typeof(line_items) = 'array'),
  -- An invoice is billed to a client business (agency) or a contact (client),
  -- never both.
  constraint square_invoices_recipient_scope_check
    check (
      (client_id is null and contact_id is null)
      or (client_id is not null and billed_client_id is null)
    ),
  constraint square_invoices_organization_client_fk
    foreign key (organization_id, client_id)
    references public.clients(organization_id, id)
    on delete cascade
);

create index if not exists square_invoices_scope_idx
  on public.square_invoices(organization_id, client_id, created_at desc);
create index if not exists square_invoices_connection_idx
  on public.square_invoices(connection_id, status);

alter table public.square_connections enable row level security;
alter table public.square_authorization_states enable row level security;
alter table public.square_invoices enable row level security;
revoke all on table public.square_connections from anon, authenticated;
revoke all on table public.square_authorization_states from anon, authenticated;
revoke all on table public.square_invoices from anon, authenticated;

comment on table public.square_connections is
  'Server-only Square seller connections with AES-256-GCM encrypted OAuth tokens; client_id null is the agency''s own account.';
comment on column public.square_connections.access_token_ciphertext is
  'AES-256-GCM ciphertext; the key lives only in Cloudflare secrets.';
comment on table public.square_authorization_states is
  'Single-use, hashed OAuth state for Square connect requests.';
comment on table public.square_invoices is
  'Invoices BrizBuilder created in a connected Square account, with the payment state Square last reported. Card data never touches BrizBuilder.';
comment on column public.square_invoices.attachment_name is
  'File name of a PDF sent to Square with the invoice. The file itself is not stored here.';
