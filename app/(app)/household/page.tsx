import { revalidatePath } from 'next/cache';
import { createClient } from '../../../lib/supabase/server';
import { formatRs, toPaisaFromRs } from '../../../lib/money';

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

export default async function HouseholdPage() {
  const { supabase, ok, familyId } = await requireParent();
  if (!ok || !familyId) return <p>Parent access required.</p>;

  const { data: categories } = await supabase
    .from('expense_categories')
    .select('id,name')
    .eq('family_id', familyId)
    .order('name');

  const { data: entries } = await supabase
    .from('household_entries')
    .select('id,entry_date,entry_type,description,amount_cents,category_id,expense_categories(name)')
    .eq('family_id', familyId)
    .order('entry_date', { ascending: false })
    .limit(100);

  async function createCategory(formData: FormData) {
    'use server';
    const name = String(formData.get('name') ?? '').trim();
    const { supabase, ok, familyId } = await requireParent();
    if (!ok || !familyId) throw new Error('Unauthorized');
    if (!name) throw new Error('Name required');
    const { error } = await supabase.from('expense_categories').insert({ family_id: familyId, name });
    if (error) throw new Error(error.message);
    revalidatePath('/household');
  }

  async function createEntry(formData: FormData) {
    'use server';
    const entry_type = String(formData.get('entry_type') ?? 'expense');
    const entry_date = String(formData.get('entry_date') ?? new Date().toISOString().slice(0, 10));
    const description = String(formData.get('description') ?? '').trim();
    const amount_cents = toPaisaFromRs(Number(formData.get('amount') ?? 0));
    const category_id_raw = String(formData.get('category_id') ?? '');
    const category_id = category_id_raw ? category_id_raw : null;

    const { supabase, ok, familyId } = await requireParent();
    if (!ok || !familyId) throw new Error('Unauthorized');
    if (!Number.isFinite(amount_cents) || amount_cents < 0) throw new Error('Invalid amount');

    const { error } = await supabase
      .from('household_entries')
      .insert({ family_id: familyId, entry_type, entry_date, description, amount_cents, category_id });
    if (error) throw new Error(error.message);
    revalidatePath('/household');
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>Household Ledger</h2>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
        <form action={createCategory} className="card" style={{ padding: 12, display: 'grid', gap: 10 }}>
          <div style={{ fontWeight: 600 }}>Create category</div>
          <input name="name" placeholder="Groceries" required />
          <button style={{ padding: '10px 12px', width: 'fit-content' }}>Add</button>
        </form>

        <form action={createEntry} className="card" style={{ padding: 12, display: 'grid', gap: 10 }}>
          <div style={{ fontWeight: 600 }}>Add entry</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={{ display: 'grid', gap: 4 }}>
              <span>Type</span>
              <select name="entry_type" defaultValue="expense">
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              <span>Date</span>
              <input name="entry_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
            </label>
          </div>

          <label style={{ display: 'grid', gap: 4 }}>
            <span>Category (optional)</span>
            <select name="category_id" defaultValue="">
              <option value="">(none)</option>
              {(categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>

          <label style={{ display: 'grid', gap: 4 }}>
            <span>Description</span>
            <input name="description" placeholder="Costco" />
          </label>

          <label style={{ display: 'grid', gap: 4 }}>
            <span>Amount (Rs.)</span>
            <input name="amount" type="number" step="0.01" min="0" placeholder="2500" required />
          </label>

          <button style={{ padding: '10px 12px', width: 'fit-content' }}>Save entry</button>
        </form>
      </div>

      <h3 style={{ marginTop: 12 }}>Recent entries</h3>
      <div style={{ display: 'grid', gap: 10 }}>
        {(entries ?? []).map((e: any) => (
          <div key={e.id} style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 600 }}>{e.entry_type.toUpperCase()} · {e.entry_date}</div>
                <div style={{ opacity: 0.85 }}>{e.description || '(no description)'}</div>
                <div style={{ opacity: 0.75, fontSize: 13 }}>{e.expense_categories?.name ?? (e.category_id ? 'Category' : 'No category')}</div>
              </div>
              <div style={{ fontWeight: 700 }}>{formatRs(e.amount_cents)}</div>
            </div>
          </div>
        ))}
        {(entries ?? []).length === 0 ? <p style={{ opacity: 0.8 }}>No entries yet.</p> : null}
      </div>
    </div>
  );
}
