import { revalidatePath } from 'next/cache';
import { createClient } from '../../../../lib/supabase/server';
import { formatRs } from '../../../../lib/money';

async function requireMom() {
  const supabase = await createClient();
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user;
  if (!user) return { supabase, user: null, familyId: null, ok: false };

  const { data: roleRow } = await supabase
    .from('user_roles')
    .select('role,family_id,parent_type')
    .eq('user_id', user.id)
    .maybeSingle();

  const ok = roleRow?.role === 'parent' && roleRow?.parent_type === 'mom';
  return { supabase, user, familyId: roleRow?.family_id ?? null, ok };
}

export default async function ApprovalsPage() {
  const { supabase, ok, familyId } = await requireMom();
  if (!ok || !familyId) {
    return (
      <div className="tile">
        <h2 style={{ marginTop: 0 }}>Approvals</h2>
        <p style={{ opacity: 0.8 }}>Only Mom can access this page. Set parent_type='mom' on the Mom user_roles row.</p>
      </div>
    );
  }

  async function approve(formData: FormData) {
    'use server';
    const completionId = String(formData.get('completion_id') ?? '');
    const { supabase, ok } = await requireMom();
    if (!ok) throw new Error('Unauthorized');
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
    const { supabase, ok } = await requireMom();
    if (!ok) throw new Error('Unauthorized');
    const { error } = await supabase.rpc('mom_reject_completion', { p_completion_id: completionId, p_notes: notes });
    if (error) throw new Error(error.message);
    revalidatePath('/admin/approvals');
    revalidatePath('/chores');
  }

  const { data: pending } = await supabase
    .from('chore_completions')
    .select('id,completed_date,submitted_at,status,review_notes,kid_id,chore_id,kids(display_name),chores(title,price_cents)')
    .eq('status', 'PENDING_APPROVAL')
    .order('submitted_at', { ascending: false });

  const rows = pending ?? [];

  const totalPending = rows.reduce((sum: number, r: any) => sum + (Number(r?.chores?.price_cents) || 0), 0);

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="tile">
        <h2 style={{ marginTop: 0 }}>Approvals</h2>
        <p style={{ opacity: 0.8, marginTop: 6 }}>
          Pending chores submitted by kids. Earnings are committed only after approval.
        </p>
        <div className="pill" style={{ display: 'inline-flex', fontWeight: 800 }}>
          Pending total: {formatRs(totalPending)}
        </div>
      </div>

      <div className="tile">
        {rows.length === 0 ? (
          <p style={{ opacity: 0.8, margin: 0 }}>No pending approvals.</p>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {rows.map((r: any) => (
              <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'start', padding: 12, border: '1px solid var(--line)', borderRadius: 14, background: '#fff' }}>
                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ fontWeight: 800 }}>
                    {r?.kids?.display_name ?? 'Kid'} — {r?.chores?.title ?? 'Chore'}
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.8 }}>
                    Date: <b>{r.completed_date}</b> &nbsp;|&nbsp; Submitted: <b>{r.submitted_at ? new Date(r.submitted_at).toLocaleString() : '-'}</b>
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.85 }}>
                    Amount: <b>{formatRs(Number(r?.chores?.price_cents) || 0)}</b>
                  </div>

                  <form action={reject} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
                    <input type="hidden" name="completion_id" value={r.id} />
                    <input
                      name="notes"
                      placeholder="Reject reason (optional)"
                      style={{ padding: '9px 10px', borderRadius: 12, border: '1px solid var(--line)', minWidth: 240 }}
                    />
                    <button type="submit" className="btn" style={{ background: '#fee2e2', borderColor: '#fecaca' }}>
                      Reject
                    </button>
                  </form>
                </div>

                <form action={approve} style={{ display: 'grid', gap: 8 }}>
                  <input type="hidden" name="completion_id" value={r.id} />
                  <button type="submit" className="btn" style={{ fontWeight: 800 }}>
                    Approve
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
