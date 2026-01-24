import { revalidatePath } from 'next/cache';
import { createClient } from '../../../../lib/supabase/server';
import { formatRs } from '../../../../lib/money';

type RoleRow = {
  role: 'parent' | 'child';
  family_id: string | null;
  parent_type?: 'mom' | 'dad' | null;
  parent_level?: number | null;
};

async function getContext() {
  const supabase = await createClient();
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user;
  if (!user) return { supabase, user: null as any, roleRow: null as RoleRow | null, familyId: null as string | null };

  const { data: roleRow } = await supabase
    .from('user_roles')
    .select('role,family_id,parent_type,parent_level')
    .eq('user_id', user.id)
    .maybeSingle();

  return { supabase, user, roleRow: (roleRow as RoleRow | null) ?? null, familyId: (roleRow as any)?.family_id ?? null };
}

function isMom(roleRow: RoleRow | null) {
  if (!roleRow) return false;
  // Back-compat: parent_type='mom' OR parent_level==1 (if you choose that convention)
  return roleRow.role === 'parent' && (roleRow.parent_type === 'mom' || (roleRow.parent_level ?? 0) === 1);
}

function isDad(roleRow: RoleRow | null) {
  if (!roleRow) return false;
  // Back-compat: parent_type='dad' OR parent_level>=2
  return roleRow.role === 'parent' && (roleRow.parent_type === 'dad' || (roleRow.parent_level ?? 0) >= 2);
}

function defaultSplit(amountCents: number) {
  // 50% spend, 20% charity, remainder savings (30% but remainder avoids rounding errors)
  const spend = Math.floor((amountCents * 50) / 100);
  const charity = Math.floor((amountCents * 20) / 100);
  const savings = amountCents - spend - charity;
  const match = savings; // parent matches savings
  return { amount: amountCents, spend, charity, savings, match };
}

export default async function ApprovalsPage() {
  const { supabase, roleRow, familyId } = await getContext();

  const mom = isMom(roleRow);
  const dad = isDad(roleRow);

  if (!roleRow || roleRow.role !== 'parent' || !familyId) {
    return (
      <div className="tile">
        <h2 style={{ marginTop: 0 }}>Approvals</h2>
        <p style={{ opacity: 0.8 }}>
          Only parent accounts can access this page.
        </p>
      </div>
    );
  }

  async function approve(formData: FormData) {
    'use server';
    const completionId = String(formData.get('completion_id') ?? '');
    const { supabase, roleRow } = await getContext();
    if (!isMom(roleRow)) throw new Error('Unauthorized: Mom only');
    const { error } = await supabase.rpc('mom_approve_completion', { p_completion_id: completionId });
    if (error) throw new Error(error.message);
    revalidatePath('/admin/approvals');
    revalidatePath('/dashboard');
    revalidatePath('/reports');
    revalidatePath('/transactions');
  }

  async function reject(formData: FormData) {
    'use server';
    const completionId = String(formData.get('completion_id') ?? '');
    const notes = String(formData.get('notes') ?? '').trim() || null;
    const { supabase, roleRow } = await getContext();
    if (!isMom(roleRow)) throw new Error('Unauthorized: Mom only');
    const { error } = await supabase.rpc('mom_reject_completion', { p_completion_id: completionId, p_notes: notes });
    if (error) throw new Error(error.message);
    revalidatePath('/admin/approvals');
    revalidatePath('/chores');
  }

  async function dadAdjust(formData: FormData) {
    'use server';
    const completionId = String(formData.get('completion_id') ?? '');
    const amount = Number(formData.get('amount_cents') ?? 0);
    const spendPct = Number(formData.get('spend_pct') ?? 50);
    const charityPct = Number(formData.get('charity_pct') ?? 20);
    const savingsPct = Number(formData.get('savings_pct') ?? 30);

    const { supabase, roleRow } = await getContext();
    if (!isDad(roleRow)) throw new Error('Unauthorized: Dad only');

    const { error } = await supabase.rpc('dad_adjust_completion', {
      p_completion_id: completionId,
      p_new_amount_cents: amount,
      p_spend_pct: spendPct,
      p_charity_pct: charityPct,
      p_savings_pct: savingsPct,
    });

    if (error) throw new Error(error.message);

    revalidatePath('/admin/approvals');
    revalidatePath('/dashboard');
    revalidatePath('/reports');
    revalidatePath('/transactions');
  }

  async function dadRevoke(formData: FormData) {
    'use server';
    const completionId = String(formData.get('completion_id') ?? '');
    const { supabase, roleRow } = await getContext();
    if (!isDad(roleRow)) throw new Error('Unauthorized: Dad only');

    const { error } = await supabase.rpc('dad_revoke_completion', { p_completion_id: completionId });
    if (error) throw new Error(error.message);

    revalidatePath('/admin/approvals');
    revalidatePath('/dashboard');
    revalidatePath('/reports');
    revalidatePath('/transactions');
  }

  const { data: pending } = await supabase
    .from('chore_completions')
    .select('id,completed_date,submitted_at,status,review_notes,kid_id,chore_id,kids(display_name),chores(title,price_cents)')
    .eq('status', 'PENDING_APPROVAL')
    .order('submitted_at', { ascending: false });

  const pendingRows = pending ?? [];
  const totalPending = pendingRows.reduce((sum: number, r: any) => sum + (Number(r?.chores?.price_cents) || 0), 0);

  // Dad needs an "approved by mom" board to edit/delete after approval.
  // Keep it simple: show the most recent 50 approved.
  const { data: approved } = await supabase
    .from('chore_completions')
    .select('id,completed_date,submitted_at,status,review_notes,kid_id,chore_id,kids(display_name),chores(title,price_cents)')
    .eq('status', 'APPROVED')
    .order('completed_date', { ascending: false })
    .limit(50);

  const approvedRows = approved ?? [];

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="tile">
        <h2 style={{ marginTop: 0 }}>Approvals</h2>
        <p style={{ opacity: 0.8, marginTop: 6 }}>
          Kids submit chores for approval. Mom approves/rejects. Dad can override (adjust/revoke) approved completions.
        </p>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div className="pill" style={{ display: 'inline-flex', fontWeight: 800 }}>
            Pending total: {formatRs(totalPending)}
          </div>

          <div className="pill" style={{ display: 'inline-flex', fontWeight: 800 }}>
            You are: {dad ? 'Dad (override enabled)' : mom ? 'Mom (approvals enabled)' : 'Parent'}
          </div>
        </div>

        {!mom && (
          <p style={{ opacity: 0.7, marginTop: 10 }}>
            Note: Approve/Reject is restricted to Mom. If you want Dad to also approve, we can switch this to “either parent” safely.
          </p>
        )}
      </div>

      {/* Pending approvals (Mom actions) */}
      <div className="tile">
        <h3 style={{ marginTop: 0 }}>Pending Approvals</h3>

        {pendingRows.length === 0 ? (
          <p style={{ opacity: 0.8, margin: 0 }}>No pending approvals.</p>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {pendingRows.map((r: any) => {
              const amountCents = Number(r?.chores?.price_cents) || 0;
              return (
                <div
                  key={r.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr auto',
                    gap: 12,
                    alignItems: 'start',
                    padding: 12,
                    border: '1px solid var(--line)',
                    borderRadius: 14,
                    background: '#fff',
                  }}
                >
                  <div style={{ display: 'grid', gap: 6 }}>
                    <div style={{ fontWeight: 800 }}>
                      {r?.kids?.display_name ?? 'Kid'} — {r?.chores?.title ?? 'Chore'}
                    </div>

                    <div style={{ fontSize: 13, opacity: 0.8 }}>
                      Date: <b>{r.completed_date}</b> &nbsp;|&nbsp; Submitted:{' '}
                      <b>{r.submitted_at ? new Date(r.submitted_at).toLocaleString() : '-'}</b>
                    </div>

                    <div style={{ fontSize: 13, opacity: 0.85 }}>
                      Amount: <b>{formatRs(amountCents)}</b>
                    </div>

                    {mom && (
                      <form
                        action={reject}
                        style={{
                          display: 'flex',
                          gap: 10,
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          marginTop: 6,
                        }}
                      >
                        <input type="hidden" name="completion_id" value={r.id} />
                        <input
                          name="notes"
                          placeholder="Reject reason (optional)"
                          style={{
                            padding: '9px 10px',
                            borderRadius: 12,
                            border: '1px solid var(--line)',
                            minWidth: 240,
                          }}
                        />
                        <button type="submit" className="btn" style={{ background: '#fee2e2', borderColor: '#fecaca' }}>
                          Reject
                        </button>
                      </form>
                    )}
                  </div>

                  {mom ? (
                    <form action={approve} style={{ display: 'grid', gap: 8 }}>
                      <input type="hidden" name="completion_id" value={r.id} />
                      <button type="submit" className="btn" style={{ fontWeight: 800 }}>
                        Approve
                      </button>
                    </form>
                  ) : (
                    <div style={{ opacity: 0.65, fontSize: 13 }}>Mom can approve/reject.</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recently approved (Dad override board) */}
      <div className="tile">
        <h3 style={{ marginTop: 0 }}>Recently Approved</h3>
        <p style={{ opacity: 0.8, marginTop: 6 }}>
          Dad can adjust splits or revoke approved completions. Defaults: 50% spend, 20% charity, 30% savings; match = savings.
        </p>

        {approvedRows.length === 0 ? (
          <p style={{ opacity: 0.8, margin: 0 }}>No approved chores yet.</p>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {approvedRows.map((r: any) => {
              const amountCents = Number(r?.chores?.price_cents) || 0;
              const d = defaultSplit(amountCents);

              return (
                <div
                  key={r.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr',
                    gap: 10,
                    padding: 12,
                    border: '1px solid var(--line)',
                    borderRadius: 14,
                    background: '#fff',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ fontWeight: 800 }}>
                      {r?.kids?.display_name ?? 'Kid'} — {r?.chores?.title ?? 'Chore'}
                    </div>
                    <div style={{ fontSize: 13, opacity: 0.8 }}>
                      Date: <b>{r.completed_date}</b>
                    </div>
                  </div>

                  <div style={{ fontSize: 13, opacity: 0.85 }}>
                    Approved Amount: <b>{formatRs(amountCents)}</b>
                  </div>

                  {!dad ? (
                    <div style={{ opacity: 0.7, fontSize: 13 }}>
                      Dad override controls are visible only to Dad (parent_level ≥ 2 or parent_type = 'dad').
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gap: 10 }}>
                      <details>
                        <summary style={{ cursor: 'pointer', fontWeight: 800 }}>Dad Override</summary>

                        <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
                          <form action={dadAdjust} style={{ display: 'grid', gap: 10 }}>
                            <input type="hidden" name="completion_id" value={r.id} />

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                              <label style={{ display: 'grid', gap: 6 }}>
                                <span style={{ fontSize: 13, opacity: 0.75 }}>New Amount (Rs)</span>
                                <input
                                  className="input"
                                  name="amount_cents"
                                  defaultValue={d.amount}
                                  inputMode="numeric"
                                />
                              </label>

                              <div style={{ display: 'grid', gap: 6 }}>
                                <span style={{ fontSize: 13, opacity: 0.75 }}>Default split preview</span>
                                <div className="pill" style={{ fontWeight: 800 }}>
                                  Spend {formatRs(d.spend)} | Charity {formatRs(d.charity)} | Savings {formatRs(d.savings)} | Match {formatRs(d.match)}
                                </div>
                              </div>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                              <label style={{ display: 'grid', gap: 6 }}>
                                <span style={{ fontSize: 13, opacity: 0.75 }}>Spend %</span>
                                <input className="input" name="spend_pct" defaultValue={50} inputMode="numeric" />
                              </label>
                              <label style={{ display: 'grid', gap: 6 }}>
                                <span style={{ fontSize: 13, opacity: 0.75 }}>Charity %</span>
                                <input className="input" name="charity_pct" defaultValue={20} inputMode="numeric" />
                              </label>
                              <label style={{ display: 'grid', gap: 6 }}>
                                <span style={{ fontSize: 13, opacity: 0.75 }}>Savings %</span>
                                <input className="input" name="savings_pct" defaultValue={30} inputMode="numeric" />
                              </label>
                            </div>

                            <button type="submit" className="btn" style={{ fontWeight: 900 }}>
                              Apply Adjustment
                            </button>
                          </form>

                          <form action={dadRevoke} style={{ display: 'grid', gap: 8 }}>
                            <input type="hidden" name="completion_id" value={r.id} />
                            <button type="submit" className="btn" style={{ background: '#fee2e2', borderColor: '#fecaca', fontWeight: 900 }}>
                              Revoke / Delete Approval
                            </button>
                          </form>

                          <div style={{ fontSize: 12, opacity: 0.7 }}>
                            Notes: Adjustments are recorded as separate ledger entries (audit-safe). Revoking marks completion as REVOKED and reverses earnings.
                          </div>
                        </div>
                      </details>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
