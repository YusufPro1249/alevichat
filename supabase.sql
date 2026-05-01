-- Alevi Sohbet + Evlilik Platformu SQL
-- Supabase SQL Editor'da calistirin.

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  username text not null unique,
  full_name text not null default '',
  phone text not null default '',
  age int,
  city text not null default '',
  hobbies text not null default '',
  about text not null default '',
  avatar_url text not null default '',
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null,
  room text not null check (room in ('genel-sohbet', 'evlilik-sohbeti', 'dini-sohbet')),
  message text not null check (char_length(trim(message)) > 0 and char_length(message) <= 1000),
  created_at timestamptz not null default now()
);

create table if not exists public.dms (
  id bigint generated always as identity primary key,
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  message text not null check (char_length(trim(message)) > 0 and char_length(message) <= 1000),
  created_at timestamptz not null default now(),
  constraint dms_not_self check (from_user_id <> to_user_id)
);

create table if not exists public.blocks (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  blocked_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint blocks_not_self check (user_id <> blocked_user_id),
  constraint blocks_unique unique (user_id, blocked_user_id)
);

create table if not exists public.reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(trim(reason)) > 0 and char_length(reason) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists idx_profiles_username on public.profiles(username);
create index if not exists idx_profiles_email on public.profiles(email);
create index if not exists idx_messages_room_created_at on public.messages(room, created_at);
create index if not exists idx_dms_to_user_id on public.dms(to_user_id);
create index if not exists idx_blocks_user_id on public.blocks(user_id);
create index if not exists idx_reports_target on public.reports(target_user_id);

-- Eski dms tablosunda from_user_id / to_user_id yoksa ekle
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'dms'
  ) then
    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public' and table_name = 'dms' and column_name = 'from_user_id'
    ) then
      alter table public.dms add column from_user_id uuid;
    end if;

    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public' and table_name = 'dms' and column_name = 'to_user_id'
    ) then
      alter table public.dms add column to_user_id uuid;
    end if;
  end if;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, username, role)
  values (
    new.id,
    coalesce(new.email, ''),
    lower(left(split_part(coalesce(new.email, 'user'), '@', 1), 40)),
    'user'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.messages enable row level security;
alter table public.dms enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;

drop policy if exists "profiles_select_auth" on public.profiles;
create policy "profiles_select_auth" on public.profiles
for select using (auth.role() = 'authenticated');

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "messages_select_auth" on public.messages;
create policy "messages_select_auth" on public.messages
for select using (auth.role() = 'authenticated');

drop policy if exists "messages_insert_own" on public.messages;
create policy "messages_insert_own" on public.messages
for insert with check (auth.uid() = user_id);

drop policy if exists "dms_select_participant" on public.dms;
create policy "dms_select_participant" on public.dms
for select using (auth.uid() = from_user_id or auth.uid() = to_user_id);

drop policy if exists "dms_insert_sender" on public.dms;
create policy "dms_insert_sender" on public.dms
for insert with check (auth.uid() = from_user_id);

drop policy if exists "blocks_select_related" on public.blocks;
create policy "blocks_select_related" on public.blocks
for select using (auth.uid() = user_id or auth.uid() = blocked_user_id);

drop policy if exists "blocks_insert_own" on public.blocks;
create policy "blocks_insert_own" on public.blocks
for insert with check (auth.uid() = user_id);

drop policy if exists "blocks_delete_own" on public.blocks;
create policy "blocks_delete_own" on public.blocks
for delete using (auth.uid() = user_id);

drop policy if exists "reports_insert_own" on public.reports;
create policy "reports_insert_own" on public.reports
for insert with check (auth.uid() = reporter_id);

drop policy if exists "reports_select_admin" on public.reports;
create policy "reports_select_admin" on public.reports
for select using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
);

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.dms;
