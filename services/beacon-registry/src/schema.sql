-- Intoponet beacon registry (PRD §4.6). Runs on any Postgres 13+, including Neon.
-- Stores only what a publisher approved on the consent screen, plus an
-- anonymous device key used for withdrawal and rate limits (never published).

create table if not exists beacons (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  title text not null,
  topic text not null,
  note text,
  place_label text,
  lat double precision,
  lon double precision,
  cell text not null,
  publisher_key text not null,
  created_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  hidden boolean not null default false,
  review_state text not null default 'none' check (review_state in ('none', 'pending', 'cleared', 'removed'))
);
-- One live beacon per device per resource.
create unique index if not exists beacons_one_per_publisher on beacons (publisher_key, url) where withdrawn_at is null;
create index if not exists beacons_visible_cell on beacons (cell) where withdrawn_at is null and not hidden;
create index if not exists beacons_visible_url on beacons (url) where withdrawn_at is null and not hidden;

create table if not exists beacon_reports (
  id uuid primary key default gen_random_uuid(),
  beacon_id uuid not null references beacons (id) on delete cascade,
  reporter_key text not null,
  kind text not null check (kind in ('spam', 'harmful', 'misleading', 'broken', 'contest')),
  text text,
  created_at timestamptz not null default now(),
  unique (beacon_id, reporter_key)
);

-- Daily counters for rate limits. Network addresses are only ever stored as a
-- salted hash that changes every day.
create table if not exists beacon_usage (
  subject text not null,
  day date not null,
  action text not null,
  count integer not null default 0,
  primary key (subject, day, action)
);

-- Replay protection for signed requests (kept 10 minutes).
create table if not exists beacon_nonces (
  nonce text primary key,
  at timestamptz not null default now()
);

-- When each anonymous device key was first and last seen. New keys are on
-- probation (lower publish limits) for their first days. Idle keys are purged.
create table if not exists beacon_keys (
  publisher_key text primary key,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

-- Every moderation decision, automatic or by a moderator, with its reason.
-- Feeds the public transparency counts; kept for two years.
create table if not exists beacon_moderation_log (
  id bigserial primary key,
  url text not null,
  action text not null check (action in ('auto-hide', 'restore', 'remove')),
  reason text not null,
  actor text not null check (actor in ('moderator', 'system')),
  at timestamptz not null default now()
);
create index if not exists beacon_moderation_log_at on beacon_moderation_log (at);
create index if not exists beacon_nonces_at on beacon_nonces (at);
