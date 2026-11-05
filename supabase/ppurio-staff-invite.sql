create table public.ppurio_staff_invites (
  digest text primary key check (digest ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null
);
create table public.ppurio_staff_devices (
  uid text not null check (length(uid) between 1 and 128),
  invite_digest text not null references public.ppurio_staff_invites(digest) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (uid, invite_digest)
);
alter table public.ppurio_staff_invites enable row level security;
alter table public.ppurio_staff_devices enable row level security;
revoke all on public.ppurio_staff_invites, public.ppurio_staff_devices from public, anon, authenticated;
grant select on public.ppurio_staff_invites to service_role;
grant select, insert on public.ppurio_staff_devices to service_role;

-- A signed-in browser can join only via the Edge Function, which supplies the verified UID.
create function public.redeem_ppurio_staff_link(invite_hash text, device_uid text)
returns boolean language sql volatile security invoker set search_path = '' as $$
  with valid as (
    select digest from public.ppurio_staff_invites where digest = invite_hash and expires_at > now()
  ), enrolled as (
    insert into public.ppurio_staff_devices (uid, invite_digest)
    select device_uid, digest from valid on conflict do nothing
  )
  select exists (select 1 from valid);
$$;
revoke all on function public.redeem_ppurio_staff_link(text,text) from public, anon, authenticated;
grant execute on function public.redeem_ppurio_staff_link(text,text) to service_role;
