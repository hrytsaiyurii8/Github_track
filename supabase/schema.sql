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

-- Storage bucket (Dashboard → Storage → New bucket: "avatars", Public: ON)
-- Or run (requires service role):
-- insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true);
