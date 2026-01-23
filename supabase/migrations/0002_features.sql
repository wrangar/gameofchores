-- Chores to $$ - feature expansion
-- Adds: Savings bucket, allocation overrides, parent daily top-up with caps, household ledger, basic reporting helpers.

-- 1) Savings bucket
alter table public.ledger_transactions
  add column if not exists savings_cents int not null default 0;

-- 2) Family settings for matching and defaults
create table if not exists public.family_settings (
  family_id uuid primary key references public.families(id) on delete cascade,
  match_enabled boolean not null default true,
  match_cap_cents_per_kid_per_day int not null default 5000,
  default_spend_pct int not null default 50,
  default_charity_pct int not null default 25,
  default_invest_pct int not null default 25,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (match_cap_cents_per_kid_per_day >= 0),
  check (default_spend_pct >= 0 and default_charity_pct >= 0 and default_invest_pct >= 0),
  check (default_spend_pct + default_charity_pct + default_invest_pct = 100)
);

-- Auto-create settings row for existing families
insert into public.family_settings (family_id)
select id from public.families
on conflict (family_id) do nothing;

create or replace function public.touch_family_settings_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_family_settings on public.family_settings;
create trigger trg_touch_family_settings
before update on public.family_settings
for each row execute function public.touch_family_settings_updated_at();

-- 3) Update completion RPC to include savings=0 and configurable default pcts
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
  v_spend_pct int;
  v_charity_pct int;
  v_invest_pct int;
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

  if not exists (
    select 1
    from public.chore_assignments ca
    join public.chores c on c.id = ca.chore_id
    where ca.kid_id = v_kid_id and ca.chore_id = p_chore_id and c.active
  ) then
    raise exception 'Chore not assigned or inactive.';
  end if;

  select price_cents into v_price
  from public.chores
  where id = p_chore_id and family_id = v_family_id and active;

  if v_price is null then
    raise exception 'Chore not found.';
  end if;

  insert into public.chore_completions (chore_id, kid_id, completed_date)
  values (p_chore_id, v_kid_id, current_date)
  on conflict (chore_id, kid_id, completed_date) do nothing;

  select default_spend_pct, default_charity_pct, default_invest_pct
    into v_spend_pct, v_charity_pct, v_invest_pct
  from public.family_settings
  where family_id = v_family_id;

  if v_spend_pct is null then
    v_spend_pct := 50;
    v_charity_pct := 25;
    v_invest_pct := 25;
  end if;

  v_spend := (v_price * v_spend_pct) / 100;
  v_charity := (v_price * v_charity_pct) / 100;
  -- remainder to invest to keep cent-safe total
  v_invest := v_price - v_spend - v_charity;

  insert into public.ledger_transactions (
    family_id, kid_id, txn_date, source, description,
    amount_cents, spend_cents, charity_cents, invest_cents, savings_cents
  ) values (
    v_family_id, v_kid_id, current_date, 'CHORE_EARNING',
    'Chore completed',
    v_price, v_spend, v_charity, v_invest, 0
  ) returning id into v_txn_id;

  return v_txn_id;
end;
$$;

-- 4) Allocation overrides (kid can move money between buckets; total must equal amount)
create or replace function public.update_allocation(
  p_txn_id uuid,
  p_spend_cents int,
  p_charity_cents int,
  p_invest_cents int,
  p_savings_cents int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_role public.app_role;
  v_kid_id uuid;
  v_family_id uuid;
  v_amount int;
  v_txn record;
begin
  select role, family_id, kid_id
    into v_role, v_family_id, v_kid_id
  from public.user_roles
  where user_id = v_user_id;

  if v_role <> 'child' then
    raise exception 'Only child accounts can update allocations.';
  end if;

  if p_spend_cents < 0 or p_charity_cents < 0 or p_invest_cents < 0 or p_savings_cents < 0 then
    raise exception 'Allocation cents must be non-negative.';
  end if;

  select * into v_txn
  from public.ledger_transactions
  where id = p_txn_id and family_id = v_family_id and kid_id = v_kid_id and source = 'CHORE_EARNING';

  if not found then
    raise exception 'Transaction not found or not editable.';
  end if;

  v_amount := v_txn.amount_cents;

  if (p_spend_cents + p_charity_cents + p_invest_cents + p_savings_cents) <> v_amount then
    raise exception 'Allocations must sum to % cents.', v_amount;
  end if;

  update public.ledger_transactions
  set spend_cents = p_spend_cents,
      charity_cents = p_charity_cents,
      invest_cents = p_invest_cents,
      savings_cents = p_savings_cents
  where id = p_txn_id;
end;
$$;

grant execute on function public.update_allocation(uuid,int,int,int,int) to authenticated;

-- 5) Parent daily top-up automation (idempotent) - matches SAVINGS per kid per day
create unique index if not exists uniq_parent_match_per_kid_day
on public.ledger_transactions (kid_id, txn_date)
where source = 'PARENT_MATCH';

create or replace function public.generate_daily_topups(p_date date default current_date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_family_id uuid;
  v_is_parent boolean;
  v_enabled boolean;
  v_cap int;
  v_count int := 0;
  r record;
  v_match int;
begin
  select family_id into v_family_id from public.user_roles where user_id = v_user_id;
  if v_family_id is null then
    raise exception 'No family assigned.';
  end if;

  select public.is_parent() into v_is_parent;
  if not v_is_parent then
    raise exception 'Only parents can generate top-ups.';
  end if;

  select match_enabled, match_cap_cents_per_kid_per_day
    into v_enabled, v_cap
  from public.family_settings
  where family_id = v_family_id;

  if coalesce(v_enabled,true) = false then
    return 0;
  end if;

  for r in
    select k.id as kid_id,
           coalesce(sum(lt.savings_cents),0) as savings_sum
    from public.kids k
    left join public.ledger_transactions lt
      on lt.kid_id = k.id
     and lt.family_id = v_family_id
     and lt.txn_date = p_date
     and lt.source = 'CHORE_EARNING'
    where k.family_id = v_family_id
    group by k.id
  loop
    v_match := least(r.savings_sum, coalesce(v_cap, 0));
    if v_match > 0 then
      insert into public.ledger_transactions (
        family_id, kid_id, txn_date, source, description,
        amount_cents, savings_cents, parent_match_cents
      ) values (
        v_family_id, r.kid_id, p_date, 'PARENT_MATCH',
        'Parent daily match',
        v_match, v_match, v_match
      ) on conflict do nothing;

      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.generate_daily_topups(date) to authenticated;

-- 6) Household ledger
create type if not exists public.household_entry_type as enum ('expense','income');

create table if not exists public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (family_id, name)
);

create table if not exists public.household_entries (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  entry_date date not null default current_date,
  entry_type public.household_entry_type not null,
  category_id uuid null references public.expense_categories(id) on delete set null,
  description text not null default '',
  amount_cents int not null check (amount_cents >= 0),
  created_at timestamptz not null default now()
);

alter table public.family_settings enable row level security;
alter table public.expense_categories enable row level security;
alter table public.household_entries enable row level security;

-- RLS: settings read for family; parents write
create policy if not exists family_settings_select on public.family_settings
for select to authenticated
using (family_id = public.current_family_id());

create policy if not exists family_settings_update_parent on public.family_settings
for update to authenticated
using (public.is_parent() and family_id = public.current_family_id())
with check (public.is_parent() and family_id = public.current_family_id());

-- categories: family read; parent write
create policy if not exists categories_select on public.expense_categories
for select to authenticated
using (family_id = public.current_family_id());

create policy if not exists categories_write_parent on public.expense_categories
for insert to authenticated
with check (public.is_parent() and family_id = public.current_family_id());

create policy if not exists categories_update_parent on public.expense_categories
for update to authenticated
using (public.is_parent() and family_id = public.current_family_id())
with check (public.is_parent() and family_id = public.current_family_id());

-- household entries: family read; parent write
create policy if not exists household_entries_select on public.household_entries
for select to authenticated
using (family_id = public.current_family_id());

create policy if not exists household_entries_write_parent on public.household_entries
for insert to authenticated
with check (public.is_parent() and family_id = public.current_family_id());

create policy if not exists household_entries_update_parent on public.household_entries
for update to authenticated
using (public.is_parent() and family_id = public.current_family_id())
with check (public.is_parent() and family_id = public.current_family_id());

-- Extend assignments policies to allow parent delete/update
create policy if not exists assignments_update_parent on public.chore_assignments
for update to authenticated
using (public.is_parent())
with check (public.is_parent());

create policy if not exists assignments_delete_parent on public.chore_assignments
for delete to authenticated
using (public.is_parent());

-- Allow parents to edit their own family's ledger (for corrections) via security definer functions only.
