-- Run in Supabase SQL Editor (https://supabase.com/dashboard → SQL)

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  github_login text not null unique,
  name text not null default '',
  company text not null default '',
  description text not null default '',
  email text not null default '',
  all_emails text[] not null default '{}',
  location text not null default '',
  country text not null default '',
  github_url text not null default '',
  avatar_url text not null default '',
  website text not null default '',
  email_source text not null default '',
  total_contributions integer not null default 0,
  public_contributions integer not null default 0,
  owner_ip text not null default '',
  contact_ip text not null default '',
  saved_ip text not null default '',
  emails_sent_count integer not null default 0,
  outreach_status text not null default 'pending'
    check (outreach_status in ('pending', 'queued', 'sent', 'read')),
  email_read_at timestamptz,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists contacts_owner_ip_added_at_idx
  on public.contacts (owner_ip, added_at desc);

create index if not exists contacts_email_idx on public.contacts (email);

-- One primary email per contact row (extra emails in all_emails are enforced by the API)
create unique index if not exists contacts_primary_email_unique_idx
  on public.contacts (lower(email))
  where email <> '';

-- Per-operator configuration archive (keyed by client IP / user identifier)
create table if not exists public.operator_profiles (
  owner_ip text primary key,
  operator_label text not null default '',
  api_url text not null default '',
  api_url_auto boolean not null default true,
  github_token text not null default '',
  gmail_user text not null default '',
  gmail_enabled boolean not null default true,
  gmail_auth_method text not null default 'app_password',
  outlook_user text not null default '',
  outlook_enabled boolean not null default true,
  config_secrets jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

-- Saemadang: daily activity log per operator
create table if not exists public.saemadang_events (
  id uuid primary key default gen_random_uuid(),
  owner_ip text not null,
  activity_date date not null default (timezone('utc', now()))::date,
  action text not null,
  summary text not null default '',
  detail jsonb not null default '{}',
  contact_login text not null default '',
  email_address text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists saemadang_owner_date_idx
  on public.saemadang_events (owner_ip, activity_date desc, created_at desc);

create index if not exists saemadang_action_idx
  on public.saemadang_events (owner_ip, action);

-- Storage: public avatars bucket (server also auto-creates this on first upload)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Allow public read of avatar images
drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read"
  on storage.objects for select
  using (bucket_id = 'avatars');

-- Service role uploads (local server uses service role key)
drop policy if exists "avatars service upload" on storage.objects;
create policy "avatars service upload"
  on storage.objects for insert
  with check (bucket_id = 'avatars');

drop policy if exists "avatars service update" on storage.objects;
create policy "avatars service update"
  on storage.objects for update
  using (bucket_id = 'avatars');
