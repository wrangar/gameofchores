import { revalidatePath } from 'next/cache';
import { createClient } from '../../../../lib/supabase/server';
import { toPaisaFromRs } from '../../../../lib/money';

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

export default async function SettingsPage() {
  const { supabase, ok, familyId } = await requireParent();
  if (!ok || !familyId) return <p>Parent access required.</p>;

  const { data: settings } = await supabase
    .from('family_settings')
    .select('*')
    .eq('family_id', familyId)
    .maybeSingle();

  async function updateSettings(formData: FormData) {
    'use server';
    const { supabase, ok, familyId } = await requireParent();
    if (!ok || !familyId) throw new Error('Unauthorized');

    const match_enabled = String(formData.get('match_enabled') ?? 'true') === 'true';
    const match_cap = Math.max(0, toPaisaFromRs(Number(formData.get('match_cap') ?? 0)));

    const spendPct = Number(formData.get('default_spend_pct') ?? 50);
    const charityPct = Number(formData.get('default_charity_pct') ?? 25);
    const investPct = Number(formData.get('default_invest_pct') ?? 25);
    if (spendPct + charityPct + investPct !== 100) throw new Error('Default % must sum to 100');

    const { error } = await supabase
      .from('family_settings')
      .update({
        match_enabled,
        match_cap_cents_per_kid_per_day: match_cap,
        default_spend_pct: spendPct,
        default_charity_pct: charityPct,
        default_invest_pct: investPct,
      })
      .eq('family_id', familyId);

    if (error) throw new Error(error.message);
    revalidatePath('/admin/settings');
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>Settings (Admin)</h2>

      <form action={updateSettings} style={{ border: '1px solid #eee', padding: 12, borderRadius: 8, display: 'grid', gap: 12, maxWidth: 620 }}>
        <div style={{ fontWeight: 600 }}>Parent match</div>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>Match enabled</span>
          <select name="match_enabled" defaultValue={String(settings?.match_enabled ?? true)}>
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>Daily match cap per kid (Rs.)</span>
          <input name="match_cap" type="number" step="1" min="0" defaultValue={settings?.match_cap_cents_per_kid_per_day ?? 5000} />
        </label>

        <div style={{ fontWeight: 600, marginTop: 4 }}>Default allocation for each chore earning</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span>Spend %</span>
            <input name="default_spend_pct" type="number" min="0" max="100" defaultValue={settings?.default_spend_pct ?? 50} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span>Charity %</span>
            <input name="default_charity_pct" type="number" min="0" max="100" defaultValue={settings?.default_charity_pct ?? 25} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span>Invest %</span>
            <input name="default_invest_pct" type="number" min="0" max="100" defaultValue={settings?.default_invest_pct ?? 25} />
          </label>
        </div>
        <div style={{ opacity: 0.75, fontSize: 13 }}>
          Savings is a separate bucket that kids can optionally fund by moving money out of Spend. Parent matching applies to <b>Savings</b> totals.
        </div>

        <button style={{ padding: '10px 12px', width: 'fit-content' }}>Save settings</button>
      </form>
    </div>
  );
}
