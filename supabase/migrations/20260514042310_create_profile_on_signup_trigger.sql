-- Auto-create a `public.profiles` row whenever a new user is provisioned
-- by Supabase Auth. The trigger fires AFTER INSERT on `auth.users` so the
-- new auth.users.id is already committed and the FK on profiles.id holds.
--
-- The function is SECURITY DEFINER because the trigger runs in the auth
-- schema's context but writes into public.profiles, which has RLS enabled.
-- We pin the search_path to '' to defeat search_path-based privilege
-- escalation per Supabase guidance, and qualify every reference
-- explicitly (public.profiles, auth.users).
--
-- We seed display_name from the user's email local-part as a sane default;
-- the user (or a future onboarding flow) can update it later via the
-- profiles table's RLS-protected UPDATE policy.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(split_part(new.email, '@', 1), ''),
      'User'
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Drop and recreate the trigger so this migration is idempotent.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- RLS policies on public.profiles so a signed-in user can only read/update
-- their own row. SELECT and UPDATE are user-scoped via auth.uid() = id.
-- INSERT is intentionally not user-policy'd because the trigger above is
-- the only writer and it runs as the function definer.
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
;
