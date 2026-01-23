-- Adds kid profile theming + goals + badges (lightweight gamification)

-- 1) Kids profile fields
alter table public.kids
  add column if not exists avatar_emoji text not null default '🙂',
  add column if not exists theme_color text not null default '#efe8ff';

-- 2) Goals
create table if not exists public.kid_goals (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  kid_id uuid not null references public.kids(id) on delete cascade,
  title text not null,
  target_cents integer not null check (target_cents >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists kid_goals_family_id_idx on public.kid_goals (family_id);
create index if not exists kid_goals_kid_id_idx on public.kid_goals (kid_id);

-- 3) Badges (unlocked)
create table if not exists public.kid_badges (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  kid_id uuid not null references public.kids(id) on delete cascade,
  badge_key text not null,
  unlocked_at timestamptz not null default now()
);
create unique index if not exists kid_badges_unique on public.kid_badges (kid_id, badge_key);

-- 4) RLS
alter table public.kid_goals enable row level security;
alter table public.kid_badges enable row level security;

-- Kids table RLS for profile fields
alter table public.kids enable row level security;

-- Helper: parent check without recursion
create or replace function public.is_parent_of_family(p_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles r
    where r.user_id = auth.uid()
      and r.role = 'parent'::public.app_role
      and r.family_id = p_family_id
  );
$$;

revoke all on function public.is_parent_of_family(uuid) from public;
grant execute on function public.is_parent_of_family(uuid) to authenticated;

-- Kids: parents can read/update kids in their family
drop policy if exists kids_parent_read_family on public.kids;
create policy kids_parent_read_family
on public.kids
for select
to authenticated
using (public.is_parent_of_family(kids.family_id));

drop policy if exists kids_parent_update_family on public.kids;
create policy kids_parent_update_family
on public.kids
for update
to authenticated
using (public.is_parent_of_family(kids.family_id))
with check (public.is_parent_of_family(kids.family_id));

-- Kids: children can read their own kid profile (for avatars/themes)
drop policy if exists kids_child_read_self on public.kids;
create policy kids_child_read_self
on public.kids
for select
to authenticated
using (
  exists (
    select 1
    from public.user_roles r
    where r.user_id = auth.uid()
      and r.role = 'child'::public.app_role
      and r.kid_id = kids.id
  )
);

-- Goals: parents can manage; kids can read their own
drop policy if exists kid_goals_parent_all on public.kid_goals;
create policy kid_goals_parent_all
on public.kid_goals
for all
to authenticated
using (public.is_parent_of_family(kid_goals.family_id))
with check (public.is_parent_of_family(kid_goals.family_id));

drop policy if exists kid_goals_child_read on public.kid_goals;
create policy kid_goals_child_read
on public.kid_goals
for select
to authenticated
using (
  exists (
    select 1
    from public.user_roles r
    where r.user_id = auth.uid()
      and r.role = 'child'::public.app_role
      and r.kid_id = kid_goals.kid_id
  )
);

-- Badges: parents can read; kids can read their own; inserts happen server-side later
drop policy if exists kid_badges_parent_read on public.kid_badges;
create policy kid_badges_parent_read
on public.kid_badges
for select
to authenticated
using (public.is_parent_of_family(kid_badges.family_id));

drop policy if exists kid_badges_child_read on public.kid_badges;
create policy kid_badges_child_read
on public.kid_badges
for select
to authenticated
using (
  exists (
    select 1
    from public.user_roles r
    where r.user_id = auth.uid()
      and r.role = 'child'::public.app_role
      and r.kid_id = kid_badges.kid_id
  )
);

grant select, insert, update, delete on public.kid_goals to authenticated;
grant select on public.kid_badges to authenticated;
