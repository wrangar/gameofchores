import { revalidatePath } from 'next/cache';
import { createClient } from '../../../../lib/supabase/server';
import ScheduleGrid from './ScheduleGrid';

type Mode = 'none' | 'daily' | 'manual';

async function requireParent() {
  const supabase = await createClient();
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user;
  if (!user) return { supabase, user: null, familyId: null, ok: false };

  const { data: roleRow, error } = await supabase
    .from('user_roles')
    .select('role,family_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) return { supabase, user, familyId: null, ok: false };
  const ok = roleRow?.role === 'parent' && !!roleRow.family_id;
  return { supabase, user, familyId: roleRow?.family_id ?? null, ok };
}

function SoftCard({ title, children, subtitle }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ display: 'grid', gap: 12 }}>
      <div>
        <div className="h2" style={{ margin: 0 }}>{title}</div>
        {subtitle ? <div className="muted" style={{ marginTop: 4 }}>{subtitle}</div> : null}
      </div>
      {children}
    </div>
  );
}

export default async function AdminAssignmentsPage({
  searchParams,
}: {
  searchParams?: { date?: string };
}) {
  const { supabase, ok, familyId } = await requireParent();
  if (!ok || !familyId) return <p>Parent access required.</p>;

  const selectedDate = (() => {
    const d = searchParams?.date;
    if (!d) return new Date().toISOString().slice(0, 10);
    // basic YYYY-MM-DD validation
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    return new Date().toISOString().slice(0, 10);
  })();

  const { data: kids, error: kidsErr } = await supabase
    .from('kids')
    .select('id,display_name,avatar_emoji,theme_color')
    .order('display_name');

  const { data: chores } = await supabase
    .from('chores')
    .select('id,title,active')
    .order('title');

  const { data: assignments } = await supabase
    .from('chore_assignments')
    .select('kid_id,chore_id,is_daily,manual_date')
    ;

  const modeMap: Record<string, Mode> = {};
  for (const a of assignments ?? []) {
    // Daily applies always. Manual applies only on the selected date.
    if (a.is_daily) modeMap[`${a.kid_id}:${a.chore_id}`] = 'daily';
    else if (a.manual_date === selectedDate) modeMap[`${a.kid_id}:${a.chore_id}`] = 'manual';
    else modeMap[`${a.kid_id}:${a.chore_id}`] = 'none';
  }

  async function setAssignment(formData: FormData) {
    'use server';
    const kid_id = String(formData.get('kid_id') ?? '');
    const chore_id = String(formData.get('chore_id') ?? '');
    const mode = String(formData.get('mode') ?? 'none') as Mode;
    const { supabase, ok, familyId } = await requireParent();
    if (!ok || !familyId) throw new Error('Unauthorized');
    if (!kid_id || !chore_id) throw new Error('Kid and chore required');

    if (mode === 'none') {
      const { error } = await supabase
        .from('chore_assignments')
        .delete()
        .eq('family_id', familyId)
        .eq('kid_id', kid_id)
        .eq('chore_id', chore_id);
      if (error) throw new Error(error.message);
    } else {
      // Idempotent: if the (kid,chore) exists, update schedule; otherwise insert.
      const date = String(formData.get('date') ?? '').slice(0, 10);
      const effectiveDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
      const { error } = await supabase
        .from('chore_assignments')
        .upsert(
          {
            family_id: familyId,
            kid_id,
            chore_id,
            is_daily: mode === 'daily',
            manual_date: mode === 'manual' ? effectiveDate : null,
          },
          { onConflict: 'chore_id,kid_id' }
        );
      if (error) throw new Error(error.message);
    }

    revalidatePath('/admin/assignments');
  }

  const choreList = (chores ?? []).filter((c) => c.active);
  const kidList = kids ?? [];

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <SoftCard
        title="Chore Schedule (One Sheet)"
        subtitle="Assign chores to each kid in one view. Each cell can be: Off, Daily, or Manual."
      >
        {kidsErr ? (
          <div className="pill" style={{ background: 'var(--rose-100)', borderColor: 'var(--rose-200)', fontWeight: 800 }}>
            Could not load kids: {kidsErr.message}
          </div>
        ) : null}
        <div className="muted" style={{ fontSize: 13, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            Schedule for{' '}
            <b>
              {new Date(selectedDate + 'T00:00:00').toLocaleDateString(undefined, {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </b>
          </div>
          <div className="pill" style={{ padding: '6px 10px' }}>
            Date: <b>{selectedDate}</b>
          </div>
        </div>
        <div className="muted" style={{ fontSize: 13 }}>
          Tip: Use <b>Daily</b> for recurring chores. Use <b>Manual</b> for chores you only want to appear when you decide.
        </div>

        <ScheduleGrid kids={kidList} chores={choreList} modeMap={modeMap} setAssignment={setAssignment} selectedDate={selectedDate} />
      </SoftCard>
    </div>
  );
}
