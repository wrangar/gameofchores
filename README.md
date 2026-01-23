# gameofchores.fun (Supabase + Next.js)

## Database migrations

### Fresh Supabase project (recommended)
Run these in Supabase (SQL Editor) in order:
1. `supabase/migrations/0001_init.sql`
2. `supabase/migrations/0002_features.sql` (Savings bucket, allocation overrides, parent top-ups, household ledger, settings)
3. `supabase/migrations/0003_kids_gamification.sql` (kid themes + goals)
4. `supabase/migrations/0004_purchases_avatars.sql` (kid purchases + cute avatars)
5. `supabase/migrations/0005_manual_date.sql` (enables "Manual" chores to appear for the day you set them)
6. `supabase/migrations/0006_invest_lock_payables_charity20.sql` (50/20/30 split, savings→invest lock 4 months, parent payables)

### Money rules (current)
* Spend: **50%**
* Charity: **20%**
* Savings: **30%**
* Parent match: **100% of Savings** (capped by `family_settings.match_cap_cents_per_kid_per_day`)
* Invest deposit: **Savings + Parent match** (locked for **4 months**)

### Existing Supabase project (you already have tables)
If you see errors like `type "app_role" already exists`, DO NOT run `0001_init.sql` again.
Instead, run any missing migrations from `0002+` (including `0005_manual_date.sql`) and then apply:
* `supabase/migrations/9999_fix_kids_rls.sql` (fixes "No kids found" by simplifying kids RLS)

## First-time setup (roles)
1. Create a family row:
   - In Supabase SQL editor: `insert into public.families (name) values ('Family') returning id;`
2. Create Auth users by signing up/signing in from the app:
   - Parent accounts: dad and mom emails
   - Kid accounts: 4 kid emails
3. Assign roles:
   - Find the Auth user IDs in **Supabase → Authentication → Users**
   - Insert roles into `public.user_roles` with your family_id

Example:
```sql
-- parents
insert into public.user_roles (user_id, family_id, role)
values
  ('<DAD_AUTH_USER_ID>', '<FAMILY_ID>', 'parent'),
  ('<MOM_AUTH_USER_ID>', '<FAMILY_ID>', 'parent');

-- kids (link each kid login to a kid profile)
-- first create kid profiles:
insert into public.kids (family_id, display_name) values
  ('<FAMILY_ID>', 'Child 1'),
  ('<FAMILY_ID>', 'Child 2'),
  ('<FAMILY_ID>', 'Child 3'),
  ('<FAMILY_ID>', 'Child 4')
returning id, display_name;

-- then map each kid auth user to the right kid_id
insert into public.user_roles (user_id, family_id, role, kid_id)
values
  ('<CHILD1_AUTH_USER_ID>', '<FAMILY_ID>', 'child', '<KID1_ID>'),
  ('<CHILD2_AUTH_USER_ID>', '<FAMILY_ID>', 'child', '<KID2_ID>'),
  ('<CHILD3_AUTH_USER_ID>', '<FAMILY_ID>', 'child', '<KID3_ID>'),
  ('<CHILD4_AUTH_USER_ID>', '<FAMILY_ID>', 'child', '<KID4_ID>');
```

## Quick start (local)
1. Install Node.js LTS.
2. `npm install`
3. Copy `.env.example` to `.env.local` and fill values.
4. `npm run dev`

## Deploy (fastest)
This repo is compatible with Vercel. Set env vars:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Troubleshooting

### Schedule / Family Overview shows "No kids found" but kids exist in DB
Run `supabase/migrations/9999_fix_kids_rls.sql` in Supabase SQL Editor, then:
1) Logout/login
2) Restart `npm run dev`
