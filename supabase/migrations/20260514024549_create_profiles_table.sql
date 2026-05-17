-- Profiles table mirroring auth.users 1:1.
-- Holds light user metadata (display name, timezone, future preferences).
-- The id column is the FK to auth.users(id) so it cascades on delete.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS: each user can only see/edit their own profile row.
alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Auto-create a profile row whenever a new user signs up via Supabase Auth.
-- security definer + locked search_path so the trigger can write to public.profiles
-- regardless of the caller's role and is not affected by search_path attacks.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data->>'display_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- updated_at auto-bump trigger.
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();;
