import { revalidatePath } from 'next/cache';
import { createClient } from '../../../../lib/supabase/server';
import { formatRs } from '../../../../lib/money';

async function requireParent() {
  const supabase = await createClient();
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user;
  if (!user) return { supabase, user: null, familyId: null, ok: false };

  const { data: roleRow } = await supabase
    .from('user_roles')
    .select('role,family_id')
    .eq('user_id', user.id)
    .maybeSingle();

  const ok = roleRow?.role === 'parent' && !!roleRow.family_id;
  return { supabase, user, familyId: roleRow?.family_id ?? null, ok };
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default async function TopupsPage() {
  const { supabase, ok, familyId } = await requireParent();
  if (!ok || !familyId) return <p>Parent access required.</p>;

  const date = todayIso();

  const { data: kids } = await supabase
    .from('kids')
    .select('id,display_name')
    .order('display_name');

  const { data: earnedToday } = await supabase
    .from('ledger_transactions')
    .select('kid_id,parent_match_cents,amount_cents')
    .eq('family_id', familyId)
    .eq('txn_date', date)
    .eq('source', 'CHORE_EARNING');

  const savingsByKid = new Map<string, number>();
  for (const row of earnedToday ?? []) {
    const prev = savingsByKid.get(row.kid_id) ?? 0;
    savingsByKid.set(row.kid_id, prev + (row.parent_match_cents ?? 0));
  }

  async function runTopups(formData: FormData) {
    'use server';
    const p_date = String(formData.get('date') ?? todayIso());
    const { supabase, ok } = await requireParent();
    if (!ok) throw new Error('Unauthorized');
    const { error } = await supabase.rpc('generate_daily_topups', { p_date });
    if (error) throw new Error(error.message);
    revalidatePath('/admin/topups');
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>Parent Top-ups</h2>
      <p style={{ margin: 0, opacity: 0.8 }}>
        Matches each kid’s <b>Savings</b> for the day (up to the cap in Settings). This is idempotent.
      </p>

      <form action={runTopups} style={{ display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>Date</span>
          <input name="date" type="date" defaultValue={date} />
        </label>
        <button style={{ padding: '10px 12px' }}>Generate top-ups</button>
      </form>

      <h3 style={{ marginTop: 12 }}>Today ({date})</h3>
      <div style={{ display: 'grid', gap: 10 }}>
        {(kids ?? []).map((k) => {
          const s = savingsByKid.get(k.id) ?? 0;
          return (
            <div key={k.id} style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8, display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{k.display_name}</div>
                <div style={{ opacity: 0.85 }}>
                  Savings (Parent match): {formatRs(s)}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700 }}>Matched: {formatRs(s)}</div>
                <div style={{ opacity: 0.75, fontSize: 13 }}>
                  {s > 0 ? 'Top-up recorded' : 'No top-up yet'}
                </div>
              </div>
            </div>
          );
        })}
        {(kids ?? []).length === 0 ? <p style={{ opacity: 0.8 }}>No kids found.</p> : null}
      </div>
    </div>
  );
}
