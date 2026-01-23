-- Chores to $$ (family portal) - initial schema

create extension if not exists "pgcrypto";

create type public.app_role as enum ('parent','child');

create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Family',
  created_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  role public.app_role not null,
  kid_id uuid null,
  created_at timestamptz not null default now()
);

create table public.kids (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

alter table public.user_roles
  add constraint user_roles_kid_fk
  foreign key (kid_id) references public.kids(id) on delete set null;

create table public.chores (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  title text not null,
  price_cents int not null check (price_cents >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.chore_assignments (
  id uuid primary key default gen_random_uuid(),
  chore_id uuid not null references public.chores(id) on delete cascade,
  kid_id uuid not null references public.kids(id) on delete cascade,
  is_daily boolean not null default true,
  created_at timestamptz not null default now(),
  unique (chore_id, kid_id)
);

create table public.chore_completions (
  id uuid primary key default gen_random_uuid(),
  chore_id uuid not null references public.chores(id) on delete cascade,
  kid_id uuid not null references public.kids(id) on delete cascade,
  completed_at timestamptz not null default now(),
  completed_date date not null default current_date,
  unique (chore_id, kid_id, completed_date)
);

-- Ledger (simple, allocation columns kept for reporting)
create table public.ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  kid_id uuid null references public.kids(id) on delete cascade,
  txn_date date not null default current_date,
  source text not null, -- CHORE_EARNING, PARENT_MATCH, MANUAL, etc.
  description text not null default '',
  amount_cents int not null check (amount_cents >= 0),
  spend_cents int not null default 0,
  charity_cents int not null default 0,
  invest_cents int not null default 0,
  parent_match_cents int not null default 0,
  created_at timestamptz not null default now()
);

-- Helper: current family
-- Helper functions
-- IMPORTANT: these are SECURITY DEFINER to avoid RLS recursion when policies need
-- the caller's family/role.
create or replace function public.current_family_id()
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

create or replace function public.is_parent()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((role = 'parent'::public.app_role), false)
  from public.user_roles
  where user_id = auth.uid()
  limit 1;
$$;

-- RPC: record a completion (child) + auto-create earnings txn with default 50/25/25
create or replace function public.record_chore_completion(p_chore_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_role public.app_role;
  v_family_id uuid;
  v_kid_id uuid;
  v_price int;
  v_spend int;
  v_charity int;
  v_invest int;
  v_txn_id uuid;
begin
  select role, family_id, kid_id
    into v_role, v_family_id, v_kid_id
  from public.user_roles
  where user_id = v_user_id;

  if v_role is null then
    raise exception 'No role assigned to this user.';
  end if;

  if v_role <> 'child' then
    raise exception 'Only child accounts can record completions.';
  end if;

  if v_kid_id is null then
    raise exception 'Child user is missing kid_id.';
  end if;

  -- ensure assigned
  if not exists (
    select 1
    from public.chore_assignments ca
    join public.chores c on c.id = ca.chore_id
    where ca.kid_id = v_kid_id and ca.chore_id = p_chore_id and c.active
  ) then
    raise exception 'Chore not assigned or inactive.';
  end if;

  -- price
  select price_cents into v_price
  from public.chores
  where id = p_chore_id and family_id = v_family_id and active;

  if v_price is null then
    raise exception 'Chore not found.';
  end if;

  -- insert completion (idempotent per-day)
  insert into public.chore_completions (chore_id, kid_id, completed_date)
  values (p_chore_id, v_kid_id, current_date)
  on conflict (chore_id, kid_id, completed_date) do nothing;

  -- default allocation: 50/25/25 with cent-safe remainder to invest
  v_spend := (v_price * 50) / 100;
  v_charity := (v_price * 25) / 100;
  v_invest := v_price - v_spend - v_charity;

  insert into public.ledger_transactions (
    family_id, kid_id, txn_date, source, description,
    amount_cents, spend_cents, charity_cents, invest_cents
  ) values (
    v_family_id, v_kid_id, current_date, 'CHORE_EARNING',
    'Chore completed',
    v_price, v_spend, v_charity, v_invest
  ) returning id into v_txn_id;

  return v_txn_id;
end;
$$;

-- View: today's chores for a kid
create or replace view public.v_kid_todays_chores as
select
  ca.kid_id,
  c.id as chore_id,
  c.title,
  c.price_cents,
  exists (
    select 1 from public.chore_completions cc
    where cc.kid_id = ca.kid_id and cc.chore_id = c.id and cc.completed_date = current_date
  ) as completed_today
from public.chore_assignments ca
join public.chores c on c.id = ca.chore_id
where c.active and ca.is_daily;

-- RLS
alter table public.families enable row level security;
alter table public.user_roles enable row level security;
alter table public.kids enable row level security;
alter table public.chores enable row level security;
alter table public.chore_assignments enable row level security;
alter table public.chore_completions enable row level security;
alter table public.ledger_transactions enable row level security;

-- families: any logged-in member of the family can read
create policy families_select on public.families
for select
to authenticated
using (id = public.current_family_id());

-- user_roles: only allow users to read their own role row.
-- (Avoid parent-in-family policy here; it can cause recursion. Admin UIs should
-- query other tables by family_id; not list roles directly.)
create policy user_roles_select_self on public.user_roles
for select
to authenticated
using (user_id = auth.uid());

-- kids: any family member can read; only parents can write
create policy kids_select on public.kids
for select
to authenticated
using (family_id = public.current_family_id());

create policy kids_write_parent on public.kids
for insert
to authenticated
with check (public.is_parent() and family_id = public.current_family_id());

create policy kids_update_parent on public.kids
for update
to authenticated
using (public.is_parent() and family_id = public.current_family_id())
with check (public.is_parent() and family_id = public.current_family_id());

-- chores: family read; parent write
create policy chores_select on public.chores
for select
to authenticated
using (family_id = public.current_family_id());

create policy chores_write_parent on public.chores
for insert
to authenticated
with check (public.is_parent() and family_id = public.current_family_id());

create policy chores_update_parent on public.chores
for update
to authenticated
using (public.is_parent() and family_id = public.current_family_id())
with check (public.is_parent() and family_id = public.current_family_id());

-- assignments: family read; parent write
create policy assignments_select on public.chore_assignments
for select
to authenticated
using (
  exists (
    select 1 from public.kids k
    where k.id = kid_id and k.family_id = public.current_family_id()
  )
);

create policy assignments_write_parent on public.chore_assignments
for insert
to authenticated
with check (public.is_parent());

-- completions: family read; child can insert for their own kid_id
create policy completions_select on public.chore_completions
for select
to authenticated
using (
  exists (
    select 1 from public.kids k
    where k.id = kid_id and k.family_id = public.current_family_id()
  )
);

create policy completions_insert_child on public.chore_completions
for insert
to authenticated
with check (
  exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = 'child' and ur.kid_id = kid_id
  )
);

-- ledger: family read; block direct inserts (use RPC)
create policy ledger_select on public.ledger_transactions
for select
to authenticated
using (family_id = public.current_family_id());

revoke insert, update, delete on public.ledger_transactions from authenticated;

-- allow calling RPC
grant execute on function public.record_chore_completion(uuid) to authenticated;
