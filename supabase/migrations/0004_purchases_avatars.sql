-- Purchases (kid spending) + avatar selection

create extension if not exists "pgcrypto";

-- 1) Kids: avatar_key (points to /public/avatars/<avatar_key>.svg)
alter table public.kids
  add column if not exists avatar_key text;

-- 2) Purchase categories (family scoped)
create table if not exists public.purchase_categories (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (family_id, name)
);

create index if not exists purchase_categories_family_idx on public.purchase_categories (family_id);

-- 3) Purchases (kid spending) - amounts stored in cents as paisa
create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  kid_id uuid not null references public.kids(id) on delete cascade,
  category_id uuid references public.purchase_categories(id) on delete set null,
  amount_cents int not null check (amount_cents > 0),
  purchase_date date not null default current_date,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists purchases_family_idx on public.purchases (family_id);
create index if not exists purchases_kid_date_idx on public.purchases (kid_id, purchase_date);

-- 4) RLS
alter table public.purchase_categories enable row level security;
alter table public.purchases enable row level security;

-- Re-runnable: drop policies if they already exist
drop policy if exists purchase_categories_select on public.purchase_categories;
drop policy if exists purchase_categories_insert_parent on public.purchase_categories;
drop policy if exists purchase_categories_update_parent on public.purchase_categories;

drop policy if exists purchases_select on public.purchases;
drop policy if exists purchases_insert on public.purchases;
drop policy if exists purchases_update on public.purchases;

-- All family members can read categories
create policy purchase_categories_select on public.purchase_categories
for select to authenticated
using (family_id = public.current_family_id());

-- Parents can manage categories
create policy purchase_categories_insert_parent on public.purchase_categories
for insert to authenticated
with check (public.is_parent() and family_id = public.current_family_id());

create policy purchase_categories_update_parent on public.purchase_categories
for update to authenticated
using (public.is_parent() and family_id = public.current_family_id())
with check (public.is_parent() and family_id = public.current_family_id());

-- Purchases: family read; child writes own; parents write any
create policy purchases_select on public.purchases
for select to authenticated
using (family_id = public.current_family_id());

create policy purchases_insert on public.purchases
for insert to authenticated
with check (
  family_id = public.current_family_id()
  and (
    public.is_parent()
    or kid_id = (select ur.kid_id from public.user_roles ur where ur.user_id = auth.uid() limit 1)
  )
);

create policy purchases_update on public.purchases
for update to authenticated
using (
  family_id = public.current_family_id()
  and (
    public.is_parent()
    or kid_id = (select ur.kid_id from public.user_roles ur where ur.user_id = auth.uid() limit 1)
  )
)
with check (
  family_id = public.current_family_id()
  and (
    public.is_parent()
    or kid_id = (select ur.kid_id from public.user_roles ur where ur.user_id = auth.uid() limit 1)
  )
);
