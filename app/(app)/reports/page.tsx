import { createClient } from '../../../lib/supabase/server';
import { formatRs } from '../../../lib/money';
import ReportFilters from './ReportFilters';

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams?: { [key: string]: string | string[] | undefined };
}) {
  const supabase = await createClient();
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user!;

  const { data: roleRow } = await supabase
    .from('user_roles')
    .select('role,family_id,kid_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!roleRow?.family_id) return <p>Missing family setup.</p>;

  const today = new Date();
  const monthStart = startOfMonth(today);
  const defaultFrom = iso(monthStart);
  const defaultTo = iso(today);

  // Read date range from query params. Validate as YYYY-MM-DD.
  const spFrom = typeof searchParams?.from === 'string' ? searchParams.from : undefined;
  const spTo = typeof searchParams?.to === 'string' ? searchParams.to : undefined;
  const isIso = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const from = isIso(spFrom) ? spFrom! : defaultFrom;
  const to = isIso(spTo) ? spTo! : defaultTo;

  const isParent = roleRow.role === 'parent';

  // Kids list (for parent reporting)
  const { data: kids } = await supabase
    .from('kids')
    .select('id,display_name')
    .order('display_name');

  // Ledger for date range
  let ledgerQuery = supabase
    .from('ledger_transactions')
    .select('kid_id,txn_date,source,amount_cents,spend_cents,charity_cents,savings_cents,invest_cents,parent_match_cents,parent_payable_cents')
    .eq('family_id', roleRow.family_id)
    .gte('txn_date', from)
    .lte('txn_date', to);

  if (!isParent && roleRow.kid_id) {
    ledgerQuery = ledgerQuery.eq('kid_id', roleRow.kid_id);
  }

  const { data: ledger } = await ledgerQuery;

  const byKid = new Map<string, { earned: number; spend: number; charity: number; savings: number; parentMatch: number; invest: number; parentPayable: number }>();
  for (const row of ledger ?? []) {
    const k = row.kid_id ?? 'HOUSEHOLD';
    const agg = byKid.get(k) ?? { earned: 0, spend: 0, charity: 0, savings: 0, parentMatch: 0, invest: 0, parentPayable: 0 };
    if (row.source === 'CHORE_EARNING') {
      agg.earned += row.amount_cents ?? 0;
      agg.spend += row.spend_cents ?? 0;
      agg.charity += row.charity_cents ?? 0;
      agg.savings += (row as any).savings_cents ?? 0;
      agg.parentMatch += row.parent_match_cents ?? 0;
      agg.invest += row.invest_cents ?? 0;
      agg.parentPayable += (row as any).parent_payable_cents ?? 0;
    }
    byKid.set(k, agg);
  }

  const familyTotals = Array.from(byKid.values()).reduce(
    (acc, a) => {
      acc.earned += a.earned;
      acc.spend += a.spend;
      acc.charity += a.charity;
      acc.savings += a.savings;
      acc.parentMatch += a.parentMatch;
      acc.invest += a.invest;
      acc.parentPayable += a.parentPayable;
      return acc;
    },
    { earned: 0, spend: 0, charity: 0, savings: 0, parentMatch: 0, invest: 0, parentPayable: 0 }
  );

  // Household summary (parents only)
  let householdSummary: { income: number; expense: number } | null = null;
  let categoryTotals: Array<{ name: string; cents: number }> = [];
  if (isParent) {
    const { data: household } = await supabase
      .from('household_entries')
      .select('entry_type,amount_cents,expense_categories(name)')
      .eq('family_id', roleRow.family_id)
      .gte('entry_date', from)
      .lte('entry_date', to);

    let income = 0;
    let expense = 0;
    const cat = new Map<string, number>();
    for (const h of household ?? []) {
      if (h.entry_type === 'income') income += h.amount_cents ?? 0;
      else expense += h.amount_cents ?? 0;
      if (h.entry_type === 'expense') {
        const name = (h as any).expense_categories?.name ?? 'Uncategorized';
        cat.set(name, (cat.get(name) ?? 0) + (h.amount_cents ?? 0));
      }
    }
    householdSummary = { income, expense };
    categoryTotals = [...cat.entries()].map(([name, cents]) => ({ name, cents })).sort((a, b) => b.cents - a.cents);
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <h2 style={{ margin: 0, color: 'white' }}>Reports</h2>
      <ReportFilters defaultFrom={defaultFrom} defaultTo={defaultTo} />
      <p style={{ margin: 0, opacity: 0.9, color: 'rgba(255,255,255,0.85)' }}>
        Period: <b>{from}</b> to <b>{to}</b>
      </p>

      <h3 style={{ marginTop: 10 }}>{isParent ? 'Kids summary' : 'My summary'}</h3>
      <div className="card" style={{ padding: 12, overflowX: 'auto' }}>
        <div className="tableWrap"><table className="table">
          <thead>
            <tr>
              <th>Kid</th>
              <th style={{ textAlign: 'right' }}>Earned</th>
              <th style={{ textAlign: 'right' }}>Spend</th>
              <th style={{ textAlign: 'right' }}>Charity</th>
              <th style={{ textAlign: 'right' }}>Savings (kid)</th>
              <th style={{ textAlign: 'right' }}>Parent match</th>
              <th style={{ textAlign: 'right' }}>Invest (locked)</th>
              {isParent ? <th style={{ textAlign: 'right' }}>Parent payable</th> : null}
            </tr>
          </thead>
          <tbody>
            {(isParent ? kids ?? [] : [{ id: roleRow.kid_id!, display_name: 'Me' }]).map((k: any) => {
              const agg = byKid.get(k.id) ?? { earned: 0, spend: 0, charity: 0, savings: 0, parentMatch: 0, invest: 0, parentPayable: 0 };
              return (
                <tr key={k.id}>
                  <td style={{ fontWeight: 800 }}>{k.display_name}</td>
                  <td style={{ textAlign: 'right' }}>{formatRs(agg.earned)}</td>
                  <td style={{ textAlign: 'right' }}>{formatRs(agg.spend)}</td>
                  <td style={{ textAlign: 'right' }}>{formatRs(agg.charity)}</td>
                  <td style={{ textAlign: 'right' }}>{formatRs(agg.savings)}</td>
                  <td style={{ textAlign: 'right' }}>{formatRs(agg.parentMatch)}</td>
                  <td style={{ textAlign: 'right' }}>{formatRs(agg.invest)}</td>
                  {isParent ? <td style={{ textAlign: 'right' }}>{formatRs(agg.parentPayable)}</td> : null}
                </tr>
              );
            })}
            {isParent ? (
              <tr>
                <td style={{ fontWeight: 900 }}>Family total</td>
                <td style={{ textAlign: 'right', fontWeight: 900 }}>{formatRs(familyTotals.earned)}</td>
                <td style={{ textAlign: 'right', fontWeight: 900 }}>{formatRs(familyTotals.spend)}</td>
                <td style={{ textAlign: 'right', fontWeight: 900 }}>{formatRs(familyTotals.charity)}</td>
                <td style={{ textAlign: 'right', fontWeight: 900 }}>{formatRs(familyTotals.savings)}</td>
                <td style={{ textAlign: 'right', fontWeight: 900 }}>{formatRs(familyTotals.parentMatch)}</td>
                <td style={{ textAlign: 'right', fontWeight: 900 }}>{formatRs(familyTotals.invest)}</td>
                <td style={{ textAlign: 'right', fontWeight: 900 }}>{formatRs(familyTotals.parentPayable)}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      </div>

      {isParent ? (
        <>
          <h3 style={{ marginTop: 10 }}>Household summary</h3>
        <div className="kpiGrid">
          <div className="tile">
            <div className="muted" style={{ fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 12 }}>Income</div>
            <div style={{ fontSize: 26, fontWeight: 1000, marginTop: 6 }}>{formatRs(householdSummary?.income ?? 0)}</div>
          </div>
          <div className="tile">
            <div className="muted" style={{ fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 12 }}>Expenses</div>
            <div style={{ fontSize: 26, fontWeight: 1000, marginTop: 6 }}>{formatRs(householdSummary?.expense ?? 0)}</div>
          </div>
          <div className="tile">
            <div className="muted" style={{ fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.5, fontSize: 12 }}>Net</div>
            <div style={{ fontSize: 26, fontWeight: 1000, marginTop: 6 }}>
              {formatRs((householdSummary?.income ?? 0) - (householdSummary?.expense ?? 0))}
            </div>
          </div>
        </div>

        <h4 style={{ marginTop: 6 }}>Expenses by category</h4>
          <div style={{ display: 'grid', gap: 8 }}>
            {categoryTotals.slice(0, 10).map((c) => (
              <div key={c.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, border: '1px solid #eee', padding: 10, borderRadius: 8 }}>
                <div>{c.name}</div>
                <div style={{ fontWeight: 700 }}>{formatRs(c.cents)}</div>
              </div>
            ))}
            {categoryTotals.length === 0 ? <p style={{ opacity: 0.8 }}>No household expenses in this period.</p> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}