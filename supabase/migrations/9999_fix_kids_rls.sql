-- Fix kids RLS to reliably return rows for the current authenticated user.
-- Run this in Supabase SQL Editor if kids exist in the database but the app shows "No kids found".

-- Helper function: family id for current user (SECURITY DEFINER so it can read user_roles)
create or replace function public.my_family_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select family_id
  from public.user_roles
  where user_id = auth.uid()
  limit 1;
$$;

-- Ensure basic privileges
grant usage on schema public to authenticated;
grant select on public.kids to authenticated;

-- Replace SELECT policies on kids with a single, deterministic policy.
alter table public.kids enable row level security;

drop policy if exists kids_child_read_self on public.kids;
drop policy if exists kids_parent_read_family on public.kids;
drop policy if exists kids_select on public.kids;
drop policy if exists kids_select_family on public.kids;

create policy kids_select_family
on public.kids
for select
to authenticated
using (family_id = public.my_family_id());
