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

export default async function AdminKidsPage() {
  const { supabase, ok, familyId } = await requireParent();
  if (!ok || !familyId) return <p>Parent access required.</p>;

  const { data: kids } = await supabase
    .from('kids')
    .select('id,display_name,avatar_emoji,avatar_key,theme_color')
    .order('display_name');

  const avatarKeys = ['cat','fox','panda','bunny','dino','bear','penguin','koala','owl'];

  const { data: goals } = await supabase
    .from('kid_goals')
    .select('id,kid_id,title,target_cents,active,created_at')
    .order('created_at', { ascending: false });

  async function updateKid(formData: FormData) {
    'use server';
    const id = String(formData.get('id') ?? '');
    const display_name = String(formData.get('display_name') ?? '').trim();
    const avatar_emoji = String(formData.get('avatar_emoji') ?? '🙂').trim() || '🙂';
    const avatar_key = String(formData.get('avatar_key') ?? '').trim() || null;
    const theme_color = String(formData.get('theme_color') ?? '#efe8ff').trim() || '#efe8ff';
    const { supabase, ok } = await requireParent();
    if (!ok) throw new Error('Unauthorized');
    const { error } = await supabase
      .from('kids')
      .update({ display_name, avatar_emoji, avatar_key, theme_color })
      .eq('id', id);
    if (error) throw new Error(error.message);
    revalidatePath('/admin/kids');
    revalidatePath('/dashboard');
  }

  async function createGoal(formData: FormData) {
    'use server';
    const kid_id = String(formData.get('kid_id') ?? '');
    const title = String(formData.get('title') ?? '').trim();
    const targetRs = Number(formData.get('target') ?? 0);
    const target_cents = toPaisaFromRs(targetRs);
    const { supabase, ok, familyId } = await requireParent();
    if (!ok || !familyId) throw new Error('Unauthorized');
    if (!kid_id) throw new Error('Kid required');
    if (!title) throw new Error('Title required');
    if (!Number.isFinite(target_cents) || target_cents < 0) throw new Error('Invalid target');
    const { error } = await supabase
      .from('kid_goals')
      .insert({ family_id: familyId, kid_id, title, target_cents });
    if (error) throw new Error(error.message);
    revalidatePath('/admin/kids');
  }

  async function toggleGoal(formData: FormData) {
    'use server';
    const id = String(formData.get('id') ?? '');
    const active = String(formData.get('active') ?? 'true') === 'true';
    const { supabase, ok } = await requireParent();
    if (!ok) throw new Error('Unauthorized');
    const { error } = await supabase.from('kid_goals').update({ active }).eq('id', id);
    if (error) throw new Error(error.message);
    revalidatePath('/admin/kids');
  }

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="card">
        <div className="h2">Kids (Avatars & Themes)</div>
        <div className="muted" style={{ marginTop: 6 }}>Customize each kid’s avatar and soft theme color used across the app.</div>

        <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
          {(kids ?? []).map((k) => (
            <div key={k.id} className="card" style={{ padding: 14 }}>
              <form action={updateKid} style={{ display: 'grid', gap: 10 }}>
                <input type="hidden" name="id" value={k.id} />
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <div className="avatar" style={{ background: k.theme_color ?? undefined, overflow: 'hidden' }}>
                    {k.avatar_key ? (
                      <img src={`/avatars/${k.avatar_key}.svg`} alt="avatar" width={28} height={28} />
                    ) : (
                      <span style={{ fontSize: 18 }}>{k.avatar_emoji ?? '🙂'}</span>
                    )}
                  </div>
                  <div style={{ fontWeight: 900 }}>{k.display_name}</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px 140px 180px', gap: 10 }}>
                  <label style={{ display: 'grid', gap: 6 }}>
                    <span className="muted" style={{ fontSize: 12 }}>Name</span>
                    <input className="input" name="display_name" defaultValue={k.display_name} required />
                  </label>
                  <label style={{ display: 'grid', gap: 6 }}>
                    <span className="muted" style={{ fontSize: 12 }}>Avatar (cute)</span>
                    <select className="input" name="avatar_key" defaultValue={k.avatar_key ?? ''}>
                      <option value="">Use emoji instead</option>
                      {avatarKeys.map((key) => (
                        <option key={key} value={key}>{key}</option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: 'grid', gap: 6 }}>
                    <span className="muted" style={{ fontSize: 12 }}>Avatar (emoji)</span>
                    <input className="input" name="avatar_emoji" defaultValue={k.avatar_emoji ?? '🙂'} maxLength={4} />
                  </label>
                  <label style={{ display: 'grid', gap: 6 }}>
                    <span className="muted" style={{ fontSize: 12 }}>Theme</span>
                    <input className="input" name="theme_color" defaultValue={k.theme_color ?? '#efe8ff'} />
                  </label>
                </div>
                <button className="btn btnPrimary" style={{ width: 'fit-content' }}>Save</button>
              </form>
            </div>
          ))}
          {(kids ?? []).length === 0 ? <div className="muted">No kids yet.</div> : null}
        </div>
      </div>

      <div className="card">
        <div className="h2">Goals</div>
        <div className="muted" style={{ marginTop: 6 }}>Set simple savings goals for motivation (e.g., “New Bike”, “Books”, “Eid Gift”).</div>

        <form action={createGoal} className="card" style={{ marginTop: 12, padding: 14, display: 'grid', gap: 10 }}>
          <div style={{ fontWeight: 900 }}>Create a goal</div>
          <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr 180px auto', gap: 10 }}>
            <select className="input" name="kid_id" defaultValue="" required>
              <option value="" disabled>Select kid</option>
              {(kids ?? []).map((k) => (
                <option key={k.id} value={k.id}>{k.display_name}</option>
              ))}
            </select>
            <input className="input" name="title" placeholder="Goal title (e.g., New Bike)" required />
            <input className="input" name="target" type="number" step="0.01" min="0" placeholder="Target (Rs.)" required />
            <button className="btn btnPrimary">Create</button>
          </div>
        </form>

        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          {(goals ?? []).map((g) => (
            <div key={g.id} className="card" style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 900 }}>{g.title}</div>
                <div className="muted" style={{ fontSize: 13 }}>Target: <b>{formatRs(g.target_cents)}</b> · {g.active ? 'Active' : 'Paused'}</div>
              </div>
              <form action={toggleGoal}>
                <input type="hidden" name="id" value={g.id} />
                <input type="hidden" name="active" value={(!g.active).toString()} />
                <button className="btn">{g.active ? 'Pause' : 'Resume'}</button>
              </form>
            </div>
          ))}
          {(goals ?? []).length === 0 ? <div className="muted">No goals yet.</div> : null}
        </div>
      </div>
    </div>
  );
}
