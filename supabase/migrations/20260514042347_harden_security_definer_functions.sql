-- 1. Revoke EXECUTE on `public.handle_new_user` from the PostgREST roles.
-- The function is only meant to be invoked by the `on_auth_user_created`
-- trigger; exposing it via /rest/v1/rpc lets any signed-in (or even
-- anonymous) request fire it, which is unnecessary attack surface for
-- a SECURITY DEFINER function.
revoke execute on function public.handle_new_user() from anon, authenticated, public;

-- 2. Pin the search_path on the existing `set_updated_at` helper so that
-- a hostile schema on the search_path cannot shadow built-ins (e.g.
-- `now()`). The function uses no schema-unqualified writes, but the
-- linter rule still applies because the search_path is role-mutable.
alter function public.set_updated_at() set search_path = '';
;
