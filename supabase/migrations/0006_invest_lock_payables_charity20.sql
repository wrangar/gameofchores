-- gameofchores.fun - Charity 20%, Savings 30%, Invest lock + parent payables
-- Amounts are stored as whole Rupees (integers). Column names keep *_cents for historical reasons.
-- Idempotent migration.

-- 0) Ensure family_settings exists (some projects may not have earlier migrations)
create table if not exists public.family_settings (
  family_id uuid primary key references public.families(id) on delete cascade,
  match_enabled boolean not null default true,
  match_cap_cents_per_kid_per_day int not null default 5000,
  default_spend_pct int not null default 50,
  default_charity_pct int not null default 20,
  default_invest_pct int not null default 30,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- If the table already exists (from older migrations), ensure defaults reflect 50/20/30
alter table public.family_settings
  alter column default_spend_pct set default 50,
  alter column default_charity_pct set default 20,
  alter column default_invest_pct set default 30;

-- If a family is still on the old defaults (50/25/25), update it to 50/20/30.
update public.family_settings
set default_charity_pct = 20,
    default_invest_pct = 30
where default_spend_pct = 50 and default_charity_pct = 25 and default_invest_pct = 25;

-- Ensure there is a settings row for every family
insert into public.family_settings (family_id)
select id from public.families
on conflict (family_id) do nothing;

-- 1) Ledger columns needed for the live board
alter table public.ledger_transactions
  add column if not exists savings_cents int not null default 0,
  add column if not exists lock_until date,
  add column if not exists parent_payable_cents int not null default 0,
  add column if not exists chore_id uuid,
  add column if not exists completion_id uuid;

-- Optional FKs (safe; only add if the referenced tables exist)
do $$
begin
  if to_regclass('public.chores') is not null then
    begin
      alter table public.ledger_transactions
        add constraint ledger_transactions_chore_fk
        foreign key (chore_id) references public.chores(id) on delete set null;
    exception when duplicate_object then
      null;
    end;
  end if;

  if to_regclass('public.chore_completions') is not null then
    begin
      alter table public.ledger_transactions
        add constraint ledger_transactions_completion_fk
        foreign key (completion_id) references public.chore_completions(id) on delete set null;
    exception when duplicate_object then
      null;
    end;
  end if;
end $$;

-- 2) Update/replace the completion RPC:
--    - No duplicate earnings
--    - 50/20/30 split (Spend/Charity/Savings)
--    - Parent match = Savings (capped)
--    - Invest = Savings + Parent match (locked 4 months)
--    - Parent payable = Amount + Parent match

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

  v_completion_id uuid;

  v_spend_pct int;
  v_charity_pct int;
  v_savings_pct int;
  v_match_enabled boolean;
  v_match_cap int;

  v_spend int;
  v_charity int;
  v_savings int;
  v_parent_match int;
  v_invest int;
  v_lock_until date;
  v_parent_payable int;
begin
  -- Caller context
  select role, family_id, kid_id
    into v_role, v_family_id, v_kid_id
  from public.user_roles
  where user_id = v_user_id
  limit 1;

  if v_role is null then
    raise exception 'No role assigned to this user.';
  end if;

  if v_role <> 'child' then
    raise exception 'Only child accounts can record completions.';
  end if;

  if v_kid_id is null then
    raise exception 'Child user is missing kid_id.';
  end if;

  -- Ensure assigned for today (Daily or Manual for today, if manual_date exists)
  if not exists (
    select 1
    from public.chore_assignments ca
    join public.chores c on c.id = ca.chore_id
    where ca.kid_id = v_kid_id
      and ca.chore_id = p_chore_id
      and c.active
      and (
        ca.is_daily = true
        or (coalesce(ca.manual_date, date '1900-01-01') = current_date)
      )
  ) then
    raise exception 'Chore is not assigned for today.';
  end if;

  -- Load chore price (whole Rs)
  select price_cents
    into v_price
  from public.chores
  where id = p_chore_id
    and family_id = v_family_id
    and active;

  if v_price is null then
    raise exception 'Chore not found or inactive.';
  end if;

  -- Insert completion (idempotent). Only pay if we inserted a new row.
  insert into public.chore_completions (chore_id, kid_id, completed_date)
  values (p_chore_id, v_kid_id, current_date)
  on conflict (kid_id, chore_id, completed_date) do nothing
  returning id into v_completion_id;

  if v_completion_id is null then
    -- Already completed today; return the existing completion id and do not double-pay.
    select id
      into v_completion_id
    from public.chore_completions
    where kid_id = v_kid_id
      and chore_id = p_chore_id
      and completed_date = current_date
    limit 1;

    return v_completion_id;
  end if;

  -- Settings (defaults: 50/20/30)
  select default_spend_pct, default_charity_pct, default_invest_pct,
         match_enabled, match_cap_cents_per_kid_per_day
    into v_spend_pct, v_charity_pct, v_savings_pct,
         v_match_enabled, v_match_cap
  from public.family_settings
  where family_id = v_family_id;

  if v_spend_pct is null then
    v_spend_pct := 50;
    v_charity_pct := 20;
    v_savings_pct := 30;
    v_match_enabled := true;
    v_match_cap := 5000;
  end if;

  -- Integer split (remainder goes to savings to keep totals consistent)
  v_spend := (v_price * v_spend_pct) / 100;
  v_charity := (v_price * v_charity_pct) / 100;
  v_savings := v_price - v_spend - v_charity;

  -- Parent match equals savings (capped)
  if v_match_enabled then
    v_parent_match := least(v_savings, v_match_cap);
  else
    v_parent_match := 0;
  end if;

  -- Invest deposit and lock (4 months)
  v_invest := v_savings + v_parent_match;
  v_lock_until := (current_date + interval '4 months')::date;

  -- Parent payable (what parents owe/need to fund): amount + match
  v_parent_payable := v_price + v_parent_match;

  insert into public.ledger_transactions (
    family_id, kid_id, txn_date, source, description,
    amount_cents, spend_cents, charity_cents, savings_cents,
    invest_cents, parent_match_cents, parent_payable_cents,
    lock_until, chore_id, completion_id
  ) values (
    v_family_id, v_kid_id, current_date, 'CHORE_EARNING',
    'Chore completed',
    v_price, v_spend, v_charity, v_savings,
    v_invest, v_parent_match, v_parent_payable,
    v_lock_until, p_chore_id, v_completion_id
  );

  return v_completion_id;
end;
$$;

grant execute on function public.record_chore_completion(uuid) to authenticated;
