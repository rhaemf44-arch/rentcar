-- Dedicated ledger for the three-recipient website admin notification.
-- No booking/customer text or phone numbers are kept here.
begin;
create table public.ppurio_admin_reservation_delivery (
  reservation_id uuid primary key,
  payload_digest text not null check (payload_digest ~ '^[a-f0-9]{64}$'),
  claim_id uuid not null,
  state text not null check (state in ('processing','accepted','rejected','unknown')),
  attempts smallint not null check (attempts between 1 and 3),
  provider_id text check (char_length(provider_id) <= 128),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((state='accepted')=(provider_id is not null))
);
alter table public.ppurio_admin_reservation_delivery enable row level security;
revoke all on table public.ppurio_admin_reservation_delivery from public, anon, authenticated, service_role;
grant select, insert, update on table public.ppurio_admin_reservation_delivery to service_role;
commit;
