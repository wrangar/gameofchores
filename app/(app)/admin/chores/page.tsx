import { revalidatePath } from 'next/cache';
import { createClient } from '../../../../lib/supabase/server';
import { formatRs, toPaisaFromRs } from '../../../../lib/money';

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

export default async function AdminChoresPage() {
  const { supabase, ok, familyId } = await requireParent();
  if (!ok || !familyId) return <p>Parent access required.</p>;

  const { data: chores } = await supabase
    .from('chores')
    .select('id,title,price_cents,active,created_at')
    .eq('family_id', familyId)
    .order('created_at', { ascending: false });

  async function createChore(formData: FormData) {
    'use server';
    const title = String(formData.get('title') ?? '').trim();
    const priceRs = Number(formData.get('price') ?? 0);
    const price_cents = toPaisaFromRs(priceRs);
    const { supabase, ok, familyId } = await requireParent();
    if (!ok || !familyId) throw new Error('Unauthorized');
    if (!title) throw new Error('Title required');
    if (!Number.isFinite(price_cents) || price_cents < 0) throw new Error('Invalid price');
    const { error } = await supabase.from('chores').insert({ family_id: familyId, title, price_cents });
    if (error) throw new Error(error.message);
    revalidatePath('/admin/chores');
  }

  async function toggleActive(formData: FormData) {
    'use server';
    const id = String(formData.get('id'));
    const active = String(formData.get('active')) === 'true';
    const { supabase, ok } = await requireParent();
    if (!ok) throw new Error('Unauthorized');
    const { error } = await supabase.from('chores').update({ active }).eq('id', id);
    if (error) throw new Error(error.message);
    revalidatePath('/admin/chores');
  }

  async function updateChore(formData: FormData) {
    'use server';
    const id = String(formData.get('id') ?? '');
    const title = String(formData.get('title') ?? '').trim();
    const priceRs = Number(formData.get('price') ?? 0);
    const price_cents = toPaisaFromRs(priceRs);
    const { supabase, ok } = await requireParent();
    if (!ok) throw new Error('Unauthorized');
    if (!id) throw new Error('Missing id');
    if (!title) throw new Error('Title required');
    if (!Number.isFinite(price_cents) || price_cents < 0) throw new Error('Invalid price');
    const { error } = await supabase.from('chores').update({ title, price_cents }).eq('id', id);
    if (error) throw new Error(error.message);
    revalidatePath('/admin/chores');
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>Chores (Admin)</h2>

      <form action={createChore} style={{ border: '1px solid #eee', padding: 12, borderRadius: 8, display: 'grid', gap: 10, maxWidth: 520 }}>
        <div style={{ fontWeight: 600 }}>Create a chore</div>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>Title</span>
          <input name="title" placeholder="Make bed" required />
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>Price (Rs.)</span>
          <input name="price" type="number" step="1" min="0" placeholder="50" required />
        </label>
        <button style={{ padding: '10px 12px', width: 'fit-content' }}>Create</button>
        <div style={{ opacity: 0.75, fontSize: 13 }}>
          After creating chores, go to <b>Assignments</b> to assign them to kids.
        </div>
      </form>

      <h3 style={{ marginTop: 8 }}>Existing chores</h3>
      <div style={{ display: 'grid', gap: 10 }}>
        {(chores ?? []).map((c) => (
          <div key={c.id} style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 600 }}>{c.title}</div>
              <div style={{ opacity: 0.8 }}>{formatRs(c.price_cents)} · {c.active ? 'Active' : 'Inactive'}</div>
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: 'pointer', opacity: 0.85 }}>Edit</summary>
                <form action={updateChore} style={{ display: 'grid', gap: 8, marginTop: 8, maxWidth: 420 }}>
                  <input type="hidden" name="id" value={c.id} />
                  <label style={{ display: 'grid', gap: 4 }}>
                    <span>Title</span>
                    <input name="title" defaultValue={c.title} required />
                  </label>
                  <label style={{ display: 'grid', gap: 4 }}>
                    <span>Price (Rs.)</span>
                    <input name="price" type="number" step="1" min="0" defaultValue={c.price_cents} required />
                  </label>
                  <button style={{ padding: '10px 12px', width: 'fit-content' }}>Save changes</button>
                </form>
              </details>
            </div>
            <form action={toggleActive}>
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="active" value={(!c.active).toString()} />
              <button style={{ padding: '10px 12px' }}>{c.active ? 'Deactivate' : 'Activate'}</button>
            </form>
          </div>
        ))}
        {(chores ?? []).length === 0 ? <p style={{ opacity: 0.8 }}>No chores yet.</p> : null}
      </div>
    </div>
  );
}
