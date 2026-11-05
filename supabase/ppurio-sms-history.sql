alter table public.ppurio_requests
  add column reservation_id text,
  add column notice_kind text check (notice_kind in ('reminder','confirmation')),
  add column recipient text,
  add column message_body text,
  add column accepted_at timestamptz;

create index ppurio_history_by_reservation
  on public.ppurio_requests (reservation_id, accepted_at desc, id desc)
  where state = 'accepted';
