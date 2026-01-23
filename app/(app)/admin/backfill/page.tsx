import { revalidatePath } from 'next/cache';
import { createClient } from '../../../../lib/supabase/server';
import { formatRs } from '../../../../lib/money';

async function requireDad() {
  const supabase = await createClient();
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user;
  if (!user) return { supabase, user: null, familyId: null, ok: false };

  const { data: roleRow } = await supabase
    .from('user_roles')
    .select('role,family_id,parent_type')
    .eq('user_id', user.id)
    .maybeSingle();

  const ok = roleRow?.role === 'parent' && roleRow?.parent_type === 'dad';
  return { supabase, user, familyId: roleRow?.family_id ?? null, ok };
}

export default async function BackfillPage() {
  const { supabase, ok, familyId } = await requireDad();
  if (!ok || !familyId) {
    return (
      <div className="tile">
        <h2 style={{ marginTop: 0 }}>Backfill</h2>
        <p style={{ opacity: 0.8 }}>Only Dad can access this page. Set parent_type='dad' on the Dad user_roles row.</p>
      </div>
    );
  }

  async function backfill(formData: FormData) {
    'use server';
    const kidId = String(formData.get('kid_id') ?? '');
    const choreId = String(formData.get('chore_id') ?? '');
    const date = String(formData.get('completed_date') ?? '');
    const notes = String(formData.get('notes') ?? '').trim() || null;

    const { supabase, ok } = await requireDad();
    if (!ok) throw new Error('Unauthorized');
    if (!kidId || !choreId || !date) throw new Error('Kid, chore, and date are required');

    const { error } = await supabase.rpc('dad_backfill_commit', {
      p_chore_id: choreId,
      p_kid_id: kidId,
      p_completed_date: date,
      p_notes: notes,
    });
    if (error) throw new Error(error.message);

    revalidatePath('/admin/backfill');
    revalidatePath('/dashboard');
    revalidatePath('/reports');
    revalidatePath('/transactions');
  }

  const { data: kids } = await supabase.from('kids').select('id,display_name').order('display_name');
  const { data: chores } = await supabase.from('chores').select('id,title,price_cents,active').eq('active', true).order('title');

  const { data: recent } = await supabase
    .from('chore_completions')
    .select('id,completed_date,reviewed_at,review_notes,source,kids(display_name),chores(title,price_cents)')
    .eq('source', 'DAD_BACKFILL')
    .order('reviewed_at', { ascending: false })
    .limit(20);

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="tile">
        <h2 style={{ marginTop: 0 }}>Backfill past chore completions</h2>
        <p style={{ opacity: 0.8, marginTop: 6 }}>
          Use this to enter historical completions from your manual records. These entries are approved and committed immediately.
        </p>
      </div>

      <div className="tile">
        <form action={backfill} style={{ display: 'grid', gap: 10, maxWidth: 620 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, opacity: 0.8 }}>Kid</span>
              <select name="kid_id" required style={{ padding: '10px 12px', borderRadius: 12, border: '1px solid var(--line)' }}>
                <option value="">Select kid...</option>
                {(kids ?? []).map((k: any) => (
                  <option key={k.id} value={k.id}>
                    {k.display_name}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, opacity: 0.8 }}>Date completed</span>
              <input type="date" name="completed_date" required style={{ padding: '10px 12px', borderRadius: 12, border: '1px solid var(--line)' }} />
            </label>
          </div>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, opacity: 0.8 }}>Chore</span>
            <select name="chore_id" required style={{ padding: '10px 12px', borderRadius: 12, border: '1px solid var(--line)' }}>
              <option value="">Select chore...</option>
              {(chores ?? []).map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.title} — {formatRs(Number(c.price_cents) || 0)}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, opacity: 0.8 }}>Notes (optional)</span>
            <input name="notes" placeholder="e.g., From notebook record" style={{ padding: '10px 12px', borderRadius: 12, border: '1px solid var(--line)' }} />
          </label>

          <button type="submit" className="btn" style={{ fontWeight: 800 }}>
            Commit backfill
          </button>
        </form>
      </div>

      <div className="tile">
        <h3 style={{ marginTop: 0 }}>Recent backfills</h3>
        {(recent ?? []).length === 0 ? (
          <p style={{ opacity: 0.8, margin: 0 }}>No backfills yet.</p>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {(recent ?? []).map((r: any) => (
              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: 12, border: '1px solid var(--line)', borderRadius: 14, background: '#fff' }}>
                <div style={{ display: 'grid', gap: 4 }}>
                  <div style={{ fontWeight: 800 }}>
                    {r?.kids?.display_name ?? 'Kid'} — {r?.chores?.title ?? 'Chore'}
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.8 }}>
                    Date: <b>{r.completed_date}</b> &nbsp;|&nbsp; Amount: <b>{formatRs(Number(r?.chores?.price_cents) || 0)}</b>
                  </div>
                  {r.review_notes ? <div style={{ fontSize: 13, opacity: 0.85 }}>Notes: {r.review_notes}</div> : null}
                </div>
                <div style={{ fontSize: 12, opacity: 0.75, textAlign: 'right' }}>
                  {r.reviewed_at ? new Date(r.reviewed_at).toLocaleString() : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
