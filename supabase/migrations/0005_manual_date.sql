-- Add manual_date to chore_assignments so "Manual" chores can be activated for a specific day.

alter table public.chore_assignments
  add column if not exists manual_date date;

-- Helpful index for kid daily view
create index if not exists chore_assignments_kid_manual_date_idx
  on public.chore_assignments (kid_id, manual_date);
