
-- Add Mom approval + Dad backfill workflows.
-- Roles: user_roles.role enum is (parent, child). Distinguish Mom vs Dad via user_roles.parent_type.

-- 1) Distinguish Mom vs Dad
alter table public.user_roles
  add column if not exists parent_type text null;

alter table public.user_roles
  drop constraint if exists user_roles_parent_type_check;

alter table public.user_roles
  add constraint user_roles_parent_type_check
  check (parent_type is null or parent_type in ('mom','dad'));

-- 2) Ensure completion status/source are constrained
alter table public.chore_completions
  drop constraint if exists chore_completions_status_check;

alter table public.chore_completions
  add constraint chore_completions_status_check
  check (status in ('PENDING_APPROVAL','APPROVED','REJECTED'));

alter table public.chore_completions
  drop constraint if exists chore_completions_source_check;

alter table public.chore_completions
  add constraint chore_completions_source_check
  check (source in ('KID_SUBMISSION','DAD_BACKFILL'));

-- 3) Tighten RLS for completions to enforce "pending only" for child inserts,
-- and allow parents to update (approve/reject) within family.
alter table public.chore_completions enable row level security;

drop policy if exists completions_insert_child on public.chore_completions;

create policy completions_insert_child_pending_only on public.chore_completions
for insert
to authenticated
with check (
  status = 'PENDING_APPROVAL'
  and source = 'KID_SUBMISSION'
  and reviewed_by is null
  and reviewed_at is null
  and exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = 'child'
      and ur.kid_id = kid_id
  )
);

drop policy if exists completions_update_parent on public.chore_completions;
create policy completions_update_parent on public.chore_completions
for update
to authenticated
using (
  exists (
    select 1
    from public.chores c
    where c.id = chore_id
      and c.family_id = public.current_family_id()
  )
  and exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = 'parent'
      and ur.family_id = public.current_family_id()
  )
)
with check (
  exists (
    select 1
    from public.chores c
    where c.id = chore_id
      and c.family_id = public.current_family_id()
  )
  and exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = 'parent'
      and ur.family_id = public.current_family_id()
  )
);

-- 4) Ledger: allow parents to insert via RPC (still revoke direct writes from clients).
alter table public.ledger_transactions enable row level security;

drop policy if exists ledger_insert_parent on public.ledger_transactions;
create policy ledger_insert_parent on public.ledger_transactions
for insert
to authenticated
with check (
  family_id = public.current_family_id()
  and exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = 'parent'
      and ur.family_id = public.current_family_id()
  )
);

-- 5) Update child completion RPC to only create a pending completion (no ledger commit).
create or replace function public.record_chore_completion(p_chore_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_kid_id uuid;
  v_today date := (now() at time zone 'utc')::date;
  v_completion_id uuid;
begin
  select kid_id into v_kid_id
  from public.user_roles
  where user_id = v_user_id and role = 'child'
  limit 1;

  if v_kid_id is null then
    raise exception 'Only children can record completions';
  end if;

  -- Ensure chore is in the same family
  if not exists (
    select 1
    from public.chores c
    where c.id = p_chore_id
      and c.family_id = public.current_family_id()
  ) then
    raise exception 'Invalid chore';
  end if;

  insert into public.chore_completions (
    id, chore_id, kid_id, completed_at, completed_date,
    status, submitted_at, source
  )
  values (
    gen_random_uuid(),
    p_chore_id,
    v_kid_id,
    now(),
    v_today,
    'PENDING_APPROVAL',
    now(),
    'KID_SUBMISSION'
  )
  on conflict (chore_id, kid_id, completed_date)
  do update set
    completed_at = excluded.completed_at,
    submitted_at = excluded.submitted_at
  returning id into v_completion_id;

  return v_completion_id;
end;
$$;

-- 6) Mom approval RPC: approve a pending completion and commit earnings to ledger.
create or replace function public.mom_approve_completion(p_completion_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
begin
  select
    cc.id as completion_id,
    cc.chore_id,
    cc.kid_id,
    cc.completed_date,
    c.family_id,
    c.title,
    c.price_cents
  into v
  from public.chore_completions cc
  join public.chores c on c.id = cc.chore_id
  where cc.id = p_completion_id
  for update;

  if not found then
    raise exception 'Completion not found';
  end if;

  -- Require Mom
  if not exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = 'parent'
      and ur.family_id = v.family_id
      and ur.parent_type = 'mom'
  ) then
    raise exception 'Not authorized (mom required)';
  end if;

  if (select status from public.chore_completions where id = p_completion_id) <> 'PENDING_APPROVAL' then
    raise exception 'Only PENDING_APPROVAL can be approved';
  end if;

  update public.chore_completions
    set status = 'APPROVED',
        reviewed_by = auth.uid(),
        reviewed_at = now()
  where id = p_completion_id;

  insert into public.ledger_transactions (
    id, family_id, kid_id, txn_date, source, description,
    amount_cents, savings_cents,
    spend_cents, charity_cents, invest_cents, parent_match_cents, parent_payable_cents,
    created_at, chore_id, completion_id
  )
  values (
    gen_random_uuid(),
    v.family_id,
    v.kid_id,
    v.completed_date,
    'CHORE_EARNING',
    'Approved chore: ' || coalesce(v.title,'Chore'),
    v.price_cents,
    v.price_cents,
    0,0,0,0,0,
    now(),
    v.chore_id,
    v.completion_id
  )
  on conflict (completion_id) do nothing;
end;
$$;

-- 7) Mom reject RPC: reject a pending completion (no ledger).
create or replace function public.mom_reject_completion(p_completion_id uuid, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_family_id uuid;
begin
  select c.family_id into v_family_id
  from public.chore_completions cc
  join public.chores c on c.id = cc.chore_id
  where cc.id = p_completion_id;

  if not found then
    raise exception 'Completion not found';
  end if;

  if not exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = 'parent'
      and ur.family_id = v_family_id
      and ur.parent_type = 'mom'
  ) then
    raise exception 'Not authorized (mom required)';
  end if;

  update public.chore_completions
    set status = 'REJECTED',
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        review_notes = p_notes
  where id = p_completion_id
    and status = 'PENDING_APPROVAL';

  if not found then
    raise exception 'Completion not pending';
  end if;
end;
$$;

-- 8) Dad backfill + commit RPC: record completion for a past date and commit immediately.
create or replace function public.dad_backfill_commit(
  p_chore_id uuid,
  p_kid_id uuid,
  p_completed_date date,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v record;
  v_completion_id uuid;
begin
  select c.family_id, c.title, c.price_cents
    into v
  from public.chores c
  where c.id = p_chore_id;

  if not found then
    raise exception 'Chore not found';
  end if;

  -- Require Dad
  if not exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role = 'parent'
      and ur.family_id = v.family_id
      and ur.parent_type = 'dad'
  ) then
    raise exception 'Not authorized (dad required)';
  end if;

  insert into public.chore_completions (
    id, chore_id, kid_id, completed_at, completed_date,
    status, submitted_at, reviewed_by, reviewed_at, review_notes, source
  )
  values (
    gen_random_uuid(),
    p_chore_id,
    p_kid_id,
    now(),
    p_completed_date,
    'APPROVED',
    now(),
    auth.uid(),
    now(),
    p_notes,
    'DAD_BACKFILL'
  )
  on conflict (chore_id, kid_id, completed_date)
  do update set
    status = 'APPROVED',
    reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at,
    review_notes = coalesce(excluded.review_notes, public.chore_completions.review_notes),
    source = 'DAD_BACKFILL'
  returning id into v_completion_id;

  insert into public.ledger_transactions (
    id, family_id, kid_id, txn_date, source, description,
    amount_cents, savings_cents,
    spend_cents, charity_cents, invest_cents, parent_match_cents, parent_payable_cents,
    created_at, chore_id, completion_id
  )
  values (
    gen_random_uuid(),
    v.family_id,
    p_kid_id,
    p_completed_date,
    'CHORE_EARNING',
    'Backfilled chore: ' || coalesce(v.title,'Chore'),
    v.price_cents,
    v.price_cents,
    0,0,0,0,0,
    now(),
    p_chore_id,
    v_completion_id
  )
  on conflict (completion_id) do nothing;

  return v_completion_id;
end;
$$;

-- Grants for RPC calls
grant execute on function public.mom_approve_completion(uuid) to authenticated;
grant execute on function public.mom_reject_completion(uuid, text) to authenticated;
grant execute on function public.dad_backfill_commit(uuid, uuid, date, text) to authenticated;
grant execute on function public.record_chore_completion(uuid) to authenticated;
