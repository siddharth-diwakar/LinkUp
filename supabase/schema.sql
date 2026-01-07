-- LinkUp backend schema + RLS policies
create extension if not exists pgcrypto;

-- Profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

-- Groups
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  join_code text not null unique,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint groups_join_code_format check (join_code ~ '^[A-Za-z0-9]{6}$')
);

create index if not exists groups_created_by_idx
  on public.groups (created_by);

-- Group members
create table if not exists public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index if not exists group_members_user_id_idx
  on public.group_members (user_id);

-- Calendar uploads (one per user)
create table if not exists public.calendar_uploads (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  storage_path text not null,
  uploaded_at timestamptz not null default now()
);

-- Weekly busy blocks (Mon-Fri)
create table if not exists public.weekday_busy_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 5),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  constraint weekday_busy_blocks_time_check check (start_time < end_time)
);

create index if not exists weekday_busy_blocks_user_weekday_time_idx
  on public.weekday_busy_blocks (user_id, weekday, start_time, end_time);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name',''));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- RLS
alter table public.profiles enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.calendar_uploads enable row level security;
alter table public.weekday_busy_blocks enable row level security;

-- Profiles: readable by any signed-in user, editable by owner
drop policy if exists "Profiles are viewable by authenticated users" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Profiles are viewable by authenticated users"
  on public.profiles
  for select
  to authenticated
  using (true);

create policy "Users can update own profile"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Helper to check membership without RLS recursion
create or replace function public.is_group_member(
  target_group uuid,
  target_user uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
begin
  return exists (
    select 1
    from public.group_members gm
    where gm.group_id = target_group
      and gm.user_id = target_user
  );
end;
$$;

alter function public.is_group_member(uuid, uuid) owner to postgres;
grant execute on function public.is_group_member(uuid, uuid) to authenticated;

-- Groups: members can read, any user can create
drop policy if exists "Group members can view groups" on public.groups;
drop policy if exists "Users can create groups" on public.groups;
create policy "Group members can view groups"
  on public.groups
  for select
  to authenticated
  using (public.is_group_member(id, auth.uid()));

create policy "Users can create groups"
  on public.groups
  for insert
  to authenticated
  with check (auth.uid() = created_by);

-- Group members: members can read, users can join for themselves
drop policy if exists "Group members can view membership" on public.group_members;
drop policy if exists "Users can join groups" on public.group_members;
drop policy if exists "Users can leave groups" on public.group_members;
create policy "Group members can view membership"
  on public.group_members
  for select
  to authenticated
  using (public.is_group_member(group_id, auth.uid()));

create policy "Users can join groups"
  on public.group_members
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can leave groups"
  on public.group_members
  for delete
  to authenticated
  using (auth.uid() = user_id);

-- Calendar uploads: owners only
drop policy if exists "Users manage their calendar uploads" on public.calendar_uploads;
create policy "Users manage their calendar uploads"
  on public.calendar_uploads
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Busy blocks: owners only
drop policy if exists "Users manage their busy blocks" on public.weekday_busy_blocks;
create policy "Users manage their busy blocks"
  on public.weekday_busy_blocks
  for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
