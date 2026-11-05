-- Only the authenticated sending function can claim or update a submission.
-- No recipient numbers, message bodies, or API credentials are stored here.
create table public.ppurio_requests (
  id text primary key check (id ~ '^[a-f0-9]{64}$'),
  state text not null check (state in ('processing', 'accepted')),
  created_at timestamptz not null default now(),
  provider_id text
);
alter table public.ppurio_requests enable row level security;
revoke all on public.ppurio_requests from public, anon, authenticated;
grant select, insert, update, delete on public.ppurio_requests to service_role;
