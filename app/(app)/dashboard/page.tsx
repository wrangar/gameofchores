import { createClient } from '../../../lib/supabase/server';
import { formatRs } from '../../../lib/money';

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function Card({ title, children, subtitle, tint }: { title: string; subtitle?: string; children: React.ReactNode; tint?: string }) {
  return (
    <div className="tile" style={{ background: tint ?? 'var(--card)' }}>
      <div style={{ display: 'grid', gap: 4 }}>
        <div style={{ fontSize: 12, letterSpacing: 0.5, opacity: 0.75, textTransform: 'uppercase' }}>{title}</div>
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

  const today = new Date().toISOString().slice(0, 10);

  // IMPORTANT: kid dashboards must be kid-scoped; parent dashboards are family-scoped.
  let ledgerTodayQuery = supabase
    .from('ledger_transactions')
    .select('source,amount_cents,spend_cents,charity_cents,savings_cents,invest_cents,parent_match_cents,parent_payable_cents,kid_id,lock_until')
    .eq('family_id', roleRow?.family_id ?? '')
    .eq('txn_date', today);

  if (role === 'child' && roleRow?.kid_id) {
    ledgerTodayQuery = ledgerTodayQuery.eq('kid_id', roleRow.kid_id);
  }

  const { data: ledgerToday } = await ledgerTodayQuery;

  let earnedToday = 0;
  let spendToday = 0;
  let charityToday = 0;
  let savingsContribToday = 0; // kid's 30% contribution
  let investToday = 0;
  let parentMatchToday = 0; // parent top-up (match)
  let parentPayableToday = 0;
  for (const t of ledgerToday ?? []) {
    if (t.source === 'CHORE_EARNING') {
      earnedToday += t.amount_cents ?? 0;
      spendToday += t.spend_cents ?? 0;
      charityToday += t.charity_cents ?? 0;
      savingsContribToday += (t.savings_cents ?? 0);
      investToday += t.invest_cents ?? 0;
      parentMatchToday += (t.parent_match_cents ?? 0);
      parentPayableToday += (t.parent_payable_cents ?? 0);
    }
  }

  // recent activity (kid-scoped for kids; family-scoped for parents)
  const recentQuery = supabase
    .from('ledger_transactions')
    .select('id,txn_date,source,description,amount_cents,spend_cents,charity_cents,invest_cents,parent_match_cents')
    .eq('family_id', roleRow?.family_id ?? '')
    .order('created_at', { ascending: false })
    .limit(8);

  const { data: recentActivity } = role === 'child' && roleRow?.kid_id
    ? await recentQuery.eq('kid_id', roleRow.kid_id)
    : await recentQuery;

  let kids: any[] = [];
  let parentMonthByKid: Array<{ kid_id: string; display_name: string; earned: number; spend: number; charity: number; savings: number; parentMatch: number; invest: number; parentPayable: number }> = [];
  let parentMonthTotals: { earned: number; spend: number; charity: number; savings: number; parentMatch: number; invest: number; parentPayable: number } | null = null;
  if (role === 'parent' && roleRow?.family_id) {
    const { data } = await supabase
      .from('kids')
      .select('id,display_name,avatar_emoji,theme_color')
      .order('display_name');
    kids = data ?? [];

    // Month-to-date summary for parents (per kid + totals)
    const from = iso(startOfMonth(new Date()));
    const to = today;
    const { data: mtd } = await supabase
      .from('ledger_transactions')
      .select('kid_id,source,amount_cents,spend_cents,charity_cents,savings_cents,invest_cents,parent_match_cents,parent_payable_cents')
      .eq('family_id', roleRow.family_id)
      .gte('txn_date', from)
      .lte('txn_date', to);

    const byKid = new Map<string, any>();
    const totals = { earned: 0, spend: 0, charity: 0, savings: 0, parentMatch: 0, invest: 0, parentPayable: 0 };
    for (const row of mtd ?? []) {
      if (row.source !== 'CHORE_EARNING') continue;
      const kidId = row.kid_id ?? '';
      const agg = byKid.get(kidId) ?? { earned: 0, spend: 0, charity: 0, savings: 0, parentMatch: 0, invest: 0, parentPayable: 0 };
      agg.earned += row.amount_cents ?? 0;
      agg.spend += row.spend_cents ?? 0;
      agg.charity += row.charity_cents ?? 0;
      agg.savings += (row as any).savings_cents ?? 0;
      agg.parentMatch += row.parent_match_cents ?? 0;
      agg.invest += row.invest_cents ?? 0;
      agg.parentPayable += (row as any).parent_payable_cents ?? 0;
      byKid.set(kidId, agg);

      totals.earned += row.amount_cents ?? 0;
      totals.spend += row.spend_cents ?? 0;
      totals.charity += row.charity_cents ?? 0;
      totals.savings += (row as any).savings_cents ?? 0;
      totals.parentMatch += row.parent_match_cents ?? 0;
      totals.invest += row.invest_cents ?? 0;
      totals.parentPayable += (row as any).parent_payable_cents ?? 0;
    }
    parentMonthTotals = totals;
    parentMonthByKid = (kids ?? []).map((k: any) => {
      const agg = byKid.get(k.id) ?? { earned: 0, spend: 0, charity: 0, savings: 0, parentMatch: 0, invest: 0, parentPayable: 0 };
      return { kid_id: k.id, display_name: k.display_name, ...agg };
    });
  }

  // Parent summary for the selected period (month-to-date)
  const periodFrom = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const periodTo = today;
  let kidsPeriod: Array<{ kid_id: string; earned: number; spend: number; charity: number; savings: number; invest: number; payable: number }> = [];
  let familyPeriodTotals = { earned: 0, spend: 0, charity: 0, savings: 0, invest: 0, payable: 0 };
  if (role === 'parent' && roleRow?.family_id) {
    const { data: ledgerPeriod } = await supabase
      .from('ledger_transactions')
      .select('kid_id,source,amount_cents,spend_cents,charity_cents,savings_cents,invest_cents,parent_payable_cents')
      .eq('family_id', roleRow.family_id)
      .gte('txn_date', periodFrom)
      .lte('txn_date', periodTo);

    const map = new Map<string, { earned: number; spend: number; charity: number; savings: number; invest: number; payable: number }>();
    for (const t of ledgerPeriod ?? []) {
      if (t.source !== 'CHORE_EARNING') continue;
      const k = t.kid_id;
      if (!k) continue;
      const agg = map.get(k) ?? { earned: 0, spend: 0, charity: 0, savings: 0, invest: 0, payable: 0 };
      agg.earned += t.amount_cents ?? 0;
      agg.spend += t.spend_cents ?? 0;
      agg.charity += t.charity_cents ?? 0;
      agg.savings += (t as any).savings_cents ?? 0;
      agg.invest += t.invest_cents ?? 0;
      agg.payable += (t as any).parent_payable_cents ?? 0;
      map.set(k, agg);
    }
    kidsPeriod = kids.map((k) => ({ kid_id: k.id, ...(map.get(k.id) ?? { earned: 0, spend: 0, charity: 0, savings: 0, invest: 0, payable: 0 }) }));
    for (const r of kidsPeriod) {
      familyPeriodTotals.earned += r.earned;
      familyPeriodTotals.spend += r.spend;
      familyPeriodTotals.charity += r.charity;
      familyPeriodTotals.savings += r.savings;
      familyPeriodTotals.invest += r.invest;
      familyPeriodTotals.payable += r.payable;
    }
  }

  // Kid profile + gamification
  let kidProfile: any = null;
  let kidGoals: any[] = [];
  let streakDays = 0;
  let investedTotalAllTime = 0;
  if (role === 'child' && roleRow?.kid_id) {
    const { data: kp } = await supabase
      .from('kids')
      .select('id,display_name,avatar_emoji,theme_color')
      .eq('id', roleRow.kid_id)
      .maybeSingle();
    kidProfile = kp;

    const { data: goalRows } = await supabase
      .from('kid_goals')
      .select('id,title,target_cents,active')
      .eq('kid_id', roleRow.kid_id)
      .eq('active', true)
      .order('created_at', { ascending: false });
    kidGoals = goalRows ?? [];

    // compute savings all-time and streak from CHORE_EARNING txn dates
    const { data: kidTxns } = await supabase
      .from('ledger_transactions')
      .select('txn_date,source,amount_cents,invest_cents')
      .eq('family_id', roleRow.family_id ?? '')
      .eq('kid_id', roleRow.kid_id)
      .in('source', ['CHORE_EARNING'])
      .order('txn_date', { ascending: false })
      .limit(120);

    const earnedDates = new Set<string>();
    for (const t of kidTxns ?? []) {
      if (t.source === 'CHORE_EARNING') {
        earnedDates.add(t.txn_date);
        investedTotalAllTime += (t.invest_cents ?? 0);
      }
    }

    // streak: consecutive days (including today if any earning today)
    let cursor = new Date();
    for (let i = 0; i < 366; i++) {
      const d = cursor.toISOString().slice(0, 10);
      if (!earnedDates.has(d)) break;
      streakDays += 1;
      cursor = new Date(cursor.getTime() - 24 * 60 * 60 * 1000);
    }
  }

  const badges = role === 'child'
    ? [
        { key: 'helper', title: 'Helper', ok: charityToday > 0, desc: 'Gave to charity today' },
        { key: 'saver', title: 'Saver', ok: earnedToday > 0 ? (savingsContribToday / earnedToday) >= 0.30 : false, desc: 'Saved at least 30% today' },
        { key: 'streak', title: 'Streak', ok: streakDays >= 3, desc: '3-day chore streak' },
      ]
    : [];

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 900, margin: 0 }}>My Wallet</div>
          <div style={{ opacity: 0.75 }}>See how your earnings are growing.</div>
        </div>
        <div style={{ opacity: 0.8, fontSize: 13 }}>
          Signed in as <b>{user.email}</b> ({role})
        </div>
      </div>

      {role === 'child' && kidProfile ? (
        <div className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="avatar" style={{ width: 44, height: 44, background: kidProfile.theme_color ?? undefined }}>
              <span style={{ fontSize: 22 }}>{kidProfile.avatar_emoji ?? '🙂'}</span>
            </div>
            <div>
              <div style={{ fontWeight: 950, fontSize: 16 }}>{kidProfile.display_name}</div>
              <div className="muted" style={{ fontSize: 13 }}>Streak: <b>{streakDays}</b> day{streakDays === 1 ? '' : 's'} · Invested total: <b>{formatRs(investedTotalAllTime)}</b></div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {badges.map((b) => (
              <span key={b.key} className="pill" style={{ width: 'auto', background: b.ok ? 'var(--mint-100)' : 'transparent' }} title={b.desc}>
                {b.ok ? '✓ ' : ''}{b.title}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
        <Card title="Spending" subtitle="Money you can use now (default 50%)" tint="var(--lav-50)">
          <div style={{ fontSize: 40, fontWeight: 900 }}>{formatRs(spendToday)}</div>
        </Card>
        <Card title="Charity" subtitle="For helping others (default 20%)" tint="var(--rose-100)">
          <div style={{ fontSize: 40, fontWeight: 900 }}>{formatRs(charityToday)}</div>
        </Card>
        <Card title="Invest" subtitle="Locked for 4 months" tint="var(--sky-100)">
          <div style={{ fontSize: 40, fontWeight: 900 }}>{formatRs(investToday)}</div>
          <div style={{ marginTop: 8, opacity: 0.75, fontSize: 13 }}>Includes your savings + parent match.</div>
        </Card>
        <Card title="Savings" subtitle="Your 30% contribution" tint="var(--mint-100)">
          <div style={{ fontSize: 40, fontWeight: 900 }}>{formatRs(savingsContribToday)}</div>
          <div style={{ marginTop: 8, opacity: 0.75, fontSize: 13 }}>Matched by parent and moved to Invest.</div>
        </Card>
      </div>

      {role === 'parent' ? (
        <div className="card" style={{ padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <div>
              <div style={{ fontWeight: 950 }}>Parent Payable Today</div>
              <div className="muted" style={{ fontSize: 13 }}>Total you need to fund today (earnings + matches)</div>
            </div>
            <div style={{ fontSize: 26, fontWeight: 950 }}>{formatRs(parentPayableToday)}</div>
          </div>
        </div>
      ) : null}

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
            <div className="tile">Parent payable (earned+match): <b>{formatRs(parentMonthTotals.parentPayable)}</b></div>
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

      {role === 'parent' ? (
        <div className="card" style={{ padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <div>
              <div style={{ fontWeight: 950 }}>Kids Summary (Month-to-date)</div>
              <div className="muted" style={{ fontSize: 13 }}>From <b>{periodFrom}</b> to <b>{periodTo}</b></div>
            </div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>
              Family earned: {formatRs(familyPeriodTotals.earned)} · Charity: {formatRs(familyPeriodTotals.charity)} · Invest: {formatRs(familyPeriodTotals.invest)}
            </div>
          </div>
          <div style={{ marginTop: 10, overflowX: 'auto' }}>
            <table className="table" style={{ minWidth: 760 }}>
              <thead>
                <tr>
                  <th>Kid</th>
                  <th style={{ textAlign: 'right' }}>Earned</th>
                  <th style={{ textAlign: 'right' }}>Spend</th>
                  <th style={{ textAlign: 'right' }}>Charity</th>
                  <th style={{ textAlign: 'right' }}>Savings</th>
                  <th style={{ textAlign: 'right' }}>Invest</th>
                  <th style={{ textAlign: 'right' }}>Parent payable</th>
                </tr>
              </thead>
              <tbody>
                {kids.map((k) => {
                  const r = kidsPeriod.find((x) => x.kid_id === k.id) ?? { earned: 0, spend: 0, charity: 0, savings: 0, invest: 0, payable: 0 } as any;
                  return (
                    <tr key={k.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div className="avatar" style={{ width: 34, height: 34, background: k.theme_color ?? undefined }}>
                            <span style={{ fontSize: 16 }}>{k.avatar_emoji ?? '🙂'}</span>
                          </div>
                          <div style={{ fontWeight: 850 }}>{k.display_name}</div>
                        </div>
                      </td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{formatRs(r.earned)}</td>
                      <td style={{ textAlign: 'right' }}>{formatRs(r.spend)}</td>
                      <td style={{ textAlign: 'right' }}>{formatRs(r.charity)}</td>
                      <td style={{ textAlign: 'right' }}>{formatRs(r.savings)}</td>
                      <td style={{ textAlign: 'right' }}>{formatRs(r.invest)}</td>
                      <td style={{ textAlign: 'right' }}>{formatRs(r.payable)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <Card title="Total Distribution" subtitle={`Today (${today}) · Total earned ${formatRs(earnedToday)}`}>
          <div style={{ display: 'grid', gap: 8, fontSize: 14 }}>
            <div>Spending: <b>{formatRs(spendToday)}</b></div>
            <div>Charity: <b>{formatRs(charityToday)}</b></div>
            <div>Savings contributed: <b>{formatRs(savingsContribToday)}</b></div>
            <div>Parent match: <b>{formatRs(parentMatchToday)}</b></div>
            <div>Invest (locked): <b>{formatRs(investToday)}</b></div>
          </div>
        </Card>

        <Card title="Recent Activity" subtitle={(recentActivity ?? []).length ? 'Latest transactions' : 'No transactions yet. Complete some chores!'}>
          <div style={{ display: 'grid', gap: 10 }}>
            {(recentActivity ?? []).map((t) => (
              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                <div style={{ display: 'grid', gap: 2 }}>
                  <div style={{ fontWeight: 700 }}>{t.source}</div>
                  <div style={{ opacity: 0.75, fontSize: 12 }}>{t.txn_date} · {t.description || ''}</div>
                </div>
                <div style={{ fontWeight: 800 }}>{formatRs(t.amount_cents ?? 0)}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {role === 'child' && kidGoals.length ? (
        <Card title="Goals" subtitle="Your active savings goals" tint="var(--lav-50)">
          <div style={{ display: 'grid', gap: 12 }}>
            {kidGoals.map((g) => {
              const target = Number(g.target_cents ?? 0);
              const pct = target > 0 ? Math.min(100, Math.round((investedTotalAllTime / target) * 100)) : 0;
              return (
                <div key={g.id} className="card" style={{ padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
                    <div style={{ fontWeight: 950 }}>{g.title}</div>
                    <div style={{ fontWeight: 900 }}>{formatRs(Math.min(investedTotalAllTime, target))} / {formatRs(target)}</div>
                  </div>
                  <div className="progressOuter" style={{ marginTop: 10 }}>
                    <div className="progressInner" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>{pct}%</div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      {role === 'parent' ? (
        <Card title="Family Overview" subtitle="Kids in your family">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {kids.map((k) => (
              <div key={k.id} className="pill" style={{ width: 'auto', padding: '8px 12px', display: 'flex', gap: 8, alignItems: 'center' }}>
                <div className="avatar" style={{ width: 28, height: 28, background: k.theme_color ?? undefined }}>
                  <span style={{ fontSize: 14 }}>{k.avatar_emoji ?? '🙂'}</span>
                </div>
                <div style={{ fontWeight: 700 }}>{k.display_name}</div>
              </div>
            ))}
            {kids.length === 0 ? <div style={{ opacity: 0.75 }}>No kids added yet.</div> : null}
          </div>
          <div style={{ marginTop: 10, opacity: 0.75, fontSize: 13 }}>
            Next step: use <b>Manage Chores</b> to create chores and <b>Assignments</b> to assign them.
          </div>
        </Card>
      ) : (
        <div style={{ opacity: 0.8 }}>Go to <b>Chores</b> to mark today’s work completed.</div>
      )}
    </div>
  );
}
