import { createClient } from '../../../lib/supabase/server';
import TransactionsClient from './ui';
import { formatRs } from '../../../lib/money';

export default async function TransactionsPage() {
  const supabase = await createClient();
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user!;

  const { data: roleRow } = await supabase
    .from('user_roles')
    .select('role,family_id,kid_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!roleRow?.family_id) return <p>Missing family setup.</p>;

  if (roleRow.role !== 'child' || !roleRow.kid_id) {
    return <p>This view is for child accounts.</p>;
  }

  const today = new Date().toISOString().slice(0, 10);

  const { data: txns } = await supabase
    .from('ledger_transactions')
    .select('id,txn_date,source,description,amount_cents,spend_cents,charity_cents,savings_cents,invest_cents,parent_match_cents,parent_payable_cents,lock_until')
    .eq('kid_id', roleRow.kid_id)
    .order('created_at', { ascending: false })
    .limit(50);

  const todays = (txns ?? []).filter((t) => t.txn_date === today);

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>Transactions</h2>
      <p style={{ margin: 0, opacity: 0.8 }}>
        Today’s allocations follow the family rule: 50% spend, 20% charity, 30% savings. Savings is matched by parents and moved to Invest (locked 4 months).
      </p>
      <TransactionsClient transactions={todays as any[]} />

      <h3 style={{ marginTop: 16 }}>Recent (read-only)</h3>
      <div style={{ display: 'grid', gap: 10 }}>
        {(txns ?? []).map((t) => (
          <div key={t.id} style={{ border: '1px solid #eee', padding: 12, borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{t.source}</div>
                <div style={{ opacity: 0.8 }}>{t.txn_date}</div>
              </div>
              <div style={{ fontWeight: 700 }}>{formatRs(t.amount_cents)}</div>
            </div>
            <div style={{ marginTop: 8, opacity: 0.9 }}>
              Spend {formatRs(t.spend_cents)} · Charity {formatRs(t.charity_cents)} · Savings {formatRs((t as any).savings_cents ?? 0)} · Invest {formatRs(t.invest_cents)}
              {(t as any).parent_match_cents ? ` · Parent match ${formatRs((t as any).parent_match_cents)}` : ''}
              {(t as any).lock_until ? ` · Locked until ${(t as any).lock_until}` : ''}
            </div>
          </div>
        ))}
        {(txns ?? []).length === 0 ? <p style={{ opacity: 0.8 }}>No transactions yet.</p> : null}
      </div>
    </div>
  );
}
