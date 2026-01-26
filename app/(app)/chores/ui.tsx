// app/(app)/chores/ui.tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '../../../lib/supabase/client';

export function ChoreActions({ completionId }: { completionId: string }) {
  const supabase = createClient();
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);

  async function revert() {
    const { error } = await supabase
      .from('chore_completions')
      .delete()
      .eq('id', completionId)
      .eq('status', 'PENDING_APPROVAL');

    if (error) {
      setMsg(error.message);
      return;
    }

    setMsg('Submission reverted.');
    router.refresh();
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <button onClick={revert}>Revert Submission</button>
      {msg && <div style={{ fontSize: 12, opacity: 0.8 }}>{msg}</div>}
    </div>
  );
}
