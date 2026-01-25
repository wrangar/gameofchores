import { createClient } from '../../../lib/supabase/server';
import { formatRs } from '../../../lib/money';

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function Card({
  title,
  children,
  subtitle,
  tint,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  tint?: string;
}) {
  return (
    <div className="tile" style={{ background: tint ?? 'var(--card)' }}>
      <div style={{ display: 'grid', gap: 4 }}>
        <div style={{ fontSize: 12, letterSpacing: 0.5, opacity: 0.75, textTransform: 'uppercase' }}>
          {title}
        </div>
        {subtitle ? <div style={{ fontSize: 13, opacity: 0.75 }}>{subtitle}</div> : null}
      </div>
      <div style={{ marginTop: 10 }}>{children}</div>
    </div>
  );
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user!;

  const { data: roleRow } = await supabase
    .from('user_roles')
    .select('role,family_id,kid_id')
    .eq('user_id', user.id)
    .maybeSingle();

  const role = roleRow?.role ?? 'unknown';
  const familyId = roleRow?.family_id ?? null;
  const kidId = roleRow?.kid_id ?? null;

  const today = iso(new Date());

  if (!familyId) {
    return (
      <div className="card" style={{ padding: 14 }}>
        <div style={{ fontWeight: 900, fontSize: 18 }}>Dashboard</div>
        <div style={{ opacity: 0.8, marginTop: 6 }}>
          No family linked to this user. Please ensure there is a row in <code>public.user_roles</code> with a valid <code>family_id</code>.
        </div>
      </div>
    );
  }

  // Ledger query (kids are kid-scoped; parents are family-scoped)
  let ledgerTodayQuery = supabase
    .from('ledger_transactions')
    .select('source,amount_cents,spend_cents,charity_cents,invest_cents,parent_match_cents,kid_id')
    .eq('family_id', familyId)
    .eq('txn_date', today);

  if (role === 'child' && kidId) {
    ledgerTodayQuery = ledgerTodayQuery.eq('kid_id', kidId);
  }

  const { data: ledgerToday } = await ledgerTodayQuery;

  // Totals
  let earnedToday = 0;
  let spendToday = 0;
  let charityToday = 0;
  let savingsContribToday = 0; // invest - match (kid contribution)
  let investToday = 0;
  let parentMatchToday = 0;
  let parentPayableToday = 0; // earned + match

  for (const t of ledgerToday ?? []) {
    if (t.source !== 'CHORE_EARNING') continue;

    const amount = Number(t.amount_cents ?? 0);
    const spend = Number(t.spend_cents ?? 0);
    const charity = Number(t.charity_cents ?? 0);
    const invest = Number(t.invest_cents ?? 0);
    const match = Number(t.parent_match_cents ?? 0);

    earnedToday += amount;
    spendToday += spend;
    charityToday += charity;
    investToday += invest;
    parentMatchToday += match;
    savingsContribToday += invest - match;

    parentPayableToday += amount + match;
  }

  // Recent activity
  let recentQuery = supabase
    .from('ledger_transactions')
    .select('id,txn_date,source,description,amount_cents,spend_cents,charity_cents,invest_cents,parent_match_cents,created_at')
    .eq('family_id', familyId)
    .order('created_at', { ascending: false })
    .limit(8);

  if (role === 'child' && kidId) {
    recentQuery = recentQuery.eq('kid_id', kidId);
  }

  const { data: recentActivity } = await recentQuery;

  // Parent MTD summary
  let parentMonthByKid: Array<{
    kid_id: string;
    display_name: string;
    earned: number;
    spend: number;
    charity: number;
    savings: number;
    parentMatch: number;
    invest: number;
    parentPayable: number;
  }> = [];

  let parentMonthTotals:
    | { earned: number; spend: number; charity: number; savings: number; parentMatch: number; invest: number; parentPayable: number }
    | null = null;

  if (role === 'parent') {
    const { data: kids } = await supabase
      .from('kids')
      .select('id,display_name,theme_color')
      .eq('family_id', familyId)
      .order('display_name');

    const from = iso(startOfMonth(new Date()));
    const to = today;

    const { data: mtd } = await supabase
      .from('ledger_transactions')
      .select('kid_id,source,amount_cents,spend_cents,charity_cents,invest_cents,parent_match_cents')
      .eq('family_id', familyId)
      .gte('txn_date', from)
      .lte('txn_date', to);

    const byKid = new Map<string, any>();
    const totals = { earned: 0, spend: 0, charity: 0, savings: 0, parentMatch: 0, invest: 0, parentPayable: 0 };

    for (const row of mtd ?? []) {
      if (row.source !== 'CHORE_EARNING') continue;

      const kId = row.kid_id ?? '';
      const amount = Number(row.amount_cents ?? 0);
      const spend = Number(row.spend_cents ?? 0);
      const charity = Number(row.charity_cents ?? 0);
      const invest = Number(row.invest_cents ?? 0);
      const match = Number(row.parent_match_cents ?? 0);

      const savings = invest - match;
      const payable = amount + match;

      const agg =
        byKid.get(kId) ?? { earned: 0, spend: 0, charity: 0, savings: 0, parentMatch: 0, invest: 0, parentPayable: 0 };

      agg.earned += amount;
      agg.spend += spend;
      agg.charity += charity;
      agg.savings += savings;
      agg.parentMatch += match;
      agg.invest += invest;
      agg.parentPayable += payable;
      byKid.set(kId, agg);

      totals.earned += amount;
      totals.spend += spend;
      totals.charity += charity;
      totals.savings += savings;
      totals.parentMatch += match;
      totals.invest += invest;
      totals.parentPayable += payable;
    }

    parentMonthTotals = totals;

    parentMonthByKid = (kids ?? []).map((k: any) => {
      const agg = byKid.get(k.id) ?? { earned: 0, spend: 0, charity: 0, savings: 0, parentMatch: 0, invest: 0, parentPayable: 0 };
      return { kid_id: k.id, display_name: k.display_name, ...agg };
    });
  }

  const isChild = role === 'child';

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 900, margin: 0 }}>Dashboard</div>
          <div style={{ opacity: 0.75 }}>
            Totals update only after Mom approves (approved earnings live in the ledger).
          </div>
        </div>
        <div style={{ opacity: 0.8, fontSize: 13 }}>
          Signed in as <b>{user.email}</b> ({role})
        </div>
      </div>

      {/* KID VIEW: no allocation tiles */}
      {isChild ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
          <Card title="Approved Earned Today" subtitle="Only approved chores count here" tint="var(--lav-50)">
            <div style={{ fontSize: 40, fontWeight: 900 }}>{formatRs(earnedToday)}</div>
          </Card>
        </div>
      ) : (
        // PARENT VIEW: keep full allocation breakdown
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
          <Card title="Spending" subtitle="Money available now" tint="var(--lav-50)">
            <div style={{ fontSize: 40, fontWeight: 900 }}>{formatRs(spendToday)}</div>
          </Card>

          <Card title="Charity" subtitle="Reserved for giving" tint="var(--rose-100)">
            <div style={{ fontSize: 40, fontWeight: 900 }}>{formatRs(charityToday)}</div>
          </Card>

          <Card title="Savings" subtitle="Kid contribution (computed)" tint="var(--mint-100)">
            <div style={{ fontSize: 40, fontWeight: 900 }}>{formatRs(savingsContribToday)}</div>
            <div style={{ marginTop: 8, opacity: 0.75, fontSize: 13 }}>Moved to Invest after parent match.</div>
          </Card>

          <Card title="Invest" subtitle="Savings + Parent match (locked)" tint="var(--sky-100)">
            <div style={{ fontSize: 40, fontWeight: 900 }}>{formatRs(investToday)}</div>
          </Card>
        </div>
      )}

      {/* Parent payable */}
      {role === 'parent' ? (
        <div className="card" style={{ padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <div>
              <div style={{ fontWeight: 950 }}>Parent Payable Today</div>
              <div className="muted" style={{ fontSize: 13 }}>Total to fund today = earned + parent match</div>
            </div>
            <div style={{ fontSize: 26, fontWeight: 950 }}>{formatRs(parentPayableToday)}</div>
          </div>
        </div>
      ) : null}

      {/* Parent month summary */}
      {role === 'parent' && parentMonthTotals ? (
        <div className="card" style={{ padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 950 }}>Month-to-date summary</div>
              <div className="muted" style={{ fontSize: 13 }}>Totals for all kids in the current month.</div>
            </div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>Earned {formatRs(parentMonthTotals.earned)}</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 12 }}>
            <div className="tile" style={{ background: 'var(--lav-50)' }}>Spend: <b>{formatRs(parentMonthTotals.spend)}</b></div>
            <div className="tile" style={{ background: 'var(--rose-100)' }}>Charity: <b>{formatRs(parentMonthTotals.charity)}</b></div>
            <div className="tile" style={{ background: 'var(--mint-100)' }}>Savings (kid contrib): <b>{formatRs(parentMonthTotals.savings)}</b></div>
            <div className="tile" style={{ background: 'var(--sky-100)' }}>Invest (locked): <b>{formatRs(parentMonthTotals.invest)}</b></div>
            <div className="tile">Parent match: <b>{formatRs(parentMonthTotals.parentMatch)}</b></div>
            <div className="tile">Parent payable: <b>{formatRs(parentMonthTotals.parentPayable)}</b></div>
          </div>

          <div style={{ marginTop: 14, overflowX: 'auto' }}>
            <table className="table" style={{ minWidth: 760 }}>
              <thead>
                <tr>
                  <th>Kid</th>
                  <th style={{ textAlign: 'right' }}>Earned</th>
                  <th style={{ textAlign: 'right' }}>Spend</th>
                  <th style={{ textAlign: 'right' }}>Charity</th>
                  <th style={{ textAlign: 'right' }}>Savings</th>
                  <th style={{ textAlign: 'right' }}>Invest</th>
                  <th style={{ textAlign: 'right' }}>Payable</th>
                </tr>
              </thead>
              <tbody>
                {parentMonthByKid.map((r) => (
                  <tr key={r.kid_id}>
                    <td style={{ fontWeight: 800 }}>{r.display_name}</td>
                    <td style={{ textAlign: 'right' }}>{formatRs(r.earned)}</td>
                    <td style={{ textAlign: 'right' }}>{formatRs(r.spend)}</td>
                    <td style={{ textAlign: 'right' }}>{formatRs(r.charity)}</td>
                    <td style={{ textAlign: 'right' }}>{formatRs(r.savings)}</td>
                    <td style={{ textAlign: 'right' }}>{formatRs(r.invest)}</td>
                    <td style={{ textAlign: 'right' }}>{formatRs(r.parentPayable)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <Card
          title="Recent Activity"
          subtitle={(recentActivity ?? []).length ? 'Latest approved transactions' : 'No approved transactions yet.'}
        >
          <div style={{ display: 'grid', gap: 10 }}>
            {(recentActivity ?? []).map((t) => (
              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                <div style={{ display: 'grid', gap: 2 }}>
                  <div style={{ fontWeight: 700 }}>{t.source}</div>
                  <div style={{ opacity: 0.75, fontSize: 12 }}>
                    {t.txn_date} · {t.description || ''}
                  </div>
                </div>
                <div style={{ fontWeight: 800 }}>{formatRs(t.amount_cents ?? 0)}</div>
              </div>
            ))}
          </div>
        </Card>

        {role !== 'parent' ? (
          <div style={{ opacity: 0.8 }}>
            Go to <b>Chores</b> to submit today’s work. Mom must approve before earnings are committed.
          </div>
        ) : null}
      </div>
    </div>
  );
}
