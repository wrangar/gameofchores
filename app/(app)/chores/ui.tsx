'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '../../../lib/supabase/browser';
import { formatRs } from '../../../lib/money';
import { useRewards } from '../../../lib/rewards/useRewards';

type ChoreRow = {
  chore_id: string;
  title: string;
  price_rs: number;
  completed_today: boolean;
};

export default function ChoresClient({
  kidId,
  chores,
}: {
  kidId: string;
  chores: ChoreRow[];
}) {
  const supabase = createClient();
  const router = useRouter();
  const rewards = useRewards('kid');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [local, setLocal] = useState(chores);

  const markDone = async (choreId: string) => {
    setBusyId(choreId);
    setMsg(null);

    // Game feel
    rewards.tap();

    const { data, error } = await supabase.rpc('record_chore_completion', { p_chore_id: choreId });
    if (error) {
      setMsg(error.message);
    } else {
      setLocal((prev) => prev.map((c) => (c.chore_id === choreId ? { ...c, completed_today: true } : c)));

      const amt = local.find((c) => c.chore_id === choreId)?.price_rs ?? 0;
      // Celebrate the action (even if approval is pending, this keeps kids engaged)
      rewards.choreCompleted(amt);

      setMsg('Submitted for approval. Earnings will be committed after Mom approves.');
      // Refresh server-rendered wallet/reports data so earnings show immediately.
      router.refresh();
    }
    setBusyId(null);
  };

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {msg ? <p style={{ color: 'crimson', margin: 0 }}>{msg}</p> : null}
      {local.map((c) => (
        <div key={c.chore_id} style={{ border: '1px solid #ddd', padding: 12, borderRadius: 8, display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 600 }}>{c.title}</div>
            <div style={{ opacity: 0.8 }}>{formatRs(c.price_rs)}</div>
          </div>
          <button
            disabled={c.completed_today || busyId === c.chore_id}
            onClick={() => markDone(c.chore_id)}
            style={{ padding: '10px 12px' }}
          >
            {c.completed_today ? 'Completed' : busyId === c.chore_id ? 'Saving...' : 'Mark complete'}
          </button>
        </div>
      ))}
      {local.length === 0 ? <p style={{ opacity: 0.8 }}>No chores assigned for today.</p> : null}
    </div>
  );
}
