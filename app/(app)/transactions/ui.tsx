'use client';

import { useMemo, useState } from 'react';
import { createClient } from '../../../lib/supabase/browser';
import { formatRs } from '../../../lib/money';

type Txn = {
  id: string;
  txn_date: string;
  source: string;
  description: string;
  amount_cents: number;
  spend_cents: number;
  charity_cents: number;
  savings_cents?: number;
  invest_cents: number;
  parent_match_cents?: number;
  lock_until?: string | null;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default function TransactionsClient({ transactions }: { transactions: Txn[] }) {
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [local, setLocal] = useState<Txn[]>(transactions);

  const editable = useMemo(
    () => local.filter((t) => t.source === 'CHORE_EARNING'),
    [local]
  );

  const setAmounts = (id: string, patch: Partial<Txn>) => {
    setLocal((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  // Allocation overrides: kids can move money between Charity and Invest.
  // Spend is derived as the remainder. Parent match is tracked separately.
  const onChangeBuckets = (t: Txn, next: { charity: number; invest: number }) => {
    const amount = t.amount_cents;
    const charity = clamp(next.charity, 0, amount);
    const invest = clamp(next.invest, 0, amount - charity);
    const spend = amount - charity - invest;
    setAmounts(t.id, {
      charity_cents: charity,
      invest_cents: invest,
      spend_cents: spend,
    });
  };

  const save = async (t: Txn) => {
    setBusy(t.id);
    setMsg(null);
    const { error } = await supabase.rpc('update_allocation', {
      p_txn_id: t.id,
      p_spend_cents: t.spend_cents,
      p_charity_cents: t.charity_cents,
      p_invest_cents: t.invest_cents,
      // Savings is tracked separately and should remain consistent with the family rule.
      // We send it back so the RPC can validate totals.
      p_savings_cents: Number(t.savings_cents ?? 0),
    });
    if (error) {
      setMsg(error.message);
    } else {
      setMsg('Saved.');
      setTimeout(() => setMsg(null), 1500);
    }
    setBusy(null);
  };

  if (editable.length === 0) {
    return <p style={{ opacity: 0.8 }}>No chore earnings today.</p>;
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {msg ? <p style={{ margin: 0, color: msg === 'Saved.' ? 'green' : 'crimson' }}>{msg}</p> : null}
      {editable.map((t) => (
        <div key={t.id} style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 600 }}>{t.description || 'Chore earning'}</div>
              <div style={{ opacity: 0.8 }}>{t.txn_date}</div>
            </div>
            <div style={{ fontWeight: 700 }}>{formatRs(t.amount_cents)}</div>
          </div>

          <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span>Charity: {formatRs(t.charity_cents)}</span>
              <input
                type="range"
                min={0}
                max={t.amount_cents}
                value={t.charity_cents}
                onChange={(e) => onChangeBuckets(t, { charity: Number(e.target.value), invest: t.invest_cents })}
              />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span>Invest: {formatRs(t.invest_cents)}</span>
              <input
                type="range"
                min={0}
                max={t.amount_cents}
                value={t.invest_cents}
                onChange={(e) => onChangeBuckets(t, { charity: t.charity_cents, invest: Number(e.target.value) })}
              />
            </label>
            {t.parent_match_cents ? (
              <div style={{ opacity: 0.9 }}>
                Savings (Parent match): {formatRs(t.parent_match_cents)}
              </div>
            ) : null}
            <div style={{ opacity: 0.9 }}>
              Spend (auto): {formatRs(t.spend_cents)}
            </div>
          </div>

          <div style={{ marginTop: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
            <button disabled={busy === t.id} onClick={() => save(t)} style={{ padding: '10px 12px' }}>
              {busy === t.id ? 'Saving...' : 'Save allocation'}
            </button>
            <span style={{ opacity: 0.75, fontSize: 13 }}>
              Tip: Increasing Charity/Invest reduces Spend.
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
