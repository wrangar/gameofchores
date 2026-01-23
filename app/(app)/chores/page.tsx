import { createClient } from '../../../lib/supabase/server';
import ChoresClient from './ui';
import { formatRs } from '../../../lib/money';

export default async function ChoresPage() {
  const supabase = await createClient();
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user!;

  const { data: roleRow } = await supabase
    .from('user_roles')
    .select('role,family_id,kid_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (roleRow?.role !== 'child' || !roleRow.kid_id) {
    return <p>Chores view is for child accounts.</p>;
  }

  // Mode 3: Show (1) all Daily chores; plus (2) Manual chores activated for today.
  // Manual chores are activated when a parent sets a cell to "Manual" for a specific date.
  const today = new Date().toISOString().slice(0, 10);

  const { data: assigned, error } = await supabase
    .from('chore_assignments')
    .select(
      `
      kid_id,
      chore_id,
      is_daily,
      manual_date,
      chores (
        id,
        title,
        price_cents,
        active
      )
    `
    )
    .eq('kid_id', roleRow.kid_id)
    .or(`is_daily.eq.true,and(is_daily.eq.false,manual_date.eq.${today})`);

  if (error) {
    return <p>Could not load chores: {error.message}</p>;
  }

  // Completed today
  const { data: completions } = await supabase
    .from('chore_completions')
    .select('chore_id')
    .eq('kid_id', roleRow.kid_id)
    .eq('completed_date', today);

  const completedSet = new Set((completions ?? []).map((c: any) => c.chore_id));

  // Earnings today (sum of CHORE_EARNING)
  const { data: earningsRows } = await supabase
    .from('ledger_transactions')
    .select('amount_cents')
    .eq('kid_id', roleRow.kid_id)
    .eq('txn_date', today)
    .eq('source', 'CHORE_EARNING');

  const earnedToday = (earningsRows ?? []).reduce((sum: number, r: any) => sum + (Number(r.amount_cents) || 0), 0);

  const { data: pendingRows } = await supabase
    .from('chore_completions')
    .select('id,chore_id,chores(price_cents)')
    .eq('kid_id', roleRow.kid_id)
    .eq('completed_date', today)
    .eq('status', 'PENDING_APPROVAL');

  const pendingToday = (pendingRows ?? []).reduce((sum: number, r: any) => sum + (Number(r?.chores?.price_cents) || 0), 0);

  const chores = (assigned ?? [])
    .map((a: any) => a.chores)
    .filter((c: any) => !!c && c.active)
    .map((c: any) => ({
      chore_id: c.id,
      title: c.title,
      price_rs: Number(c.price_cents) || 0,
      completed_today: completedSet.has(c.id),
    }))
    .sort((a: any, b: any) => String(a.title).localeCompare(String(b.title)));

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0 }}>Today’s Chores</h2>
          <div className="muted" style={{ marginTop: 4 }}>
            {new Date().toLocaleDateString(undefined, {
              weekday: 'long',
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </div>
        </div>
        <div className="pill" style={{ fontWeight: 800 }}>
          Approved today: {formatRs(earnedToday)}
        </div>
        <div className="pill" style={{ fontWeight: 800, background: '#fff7ed', borderColor: '#fed7aa' }}>
          Pending: {formatRs(pendingToday)}

        </div>
      </div>

      <ChoresClient kidId={roleRow.kid_id} chores={chores as any[]} />
    </div>
  );
}