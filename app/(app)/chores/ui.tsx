"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

export function ChoreActions({ completionId }: { completionId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function revert() {
    setMsg(null);
    setBusy(true);

    try {
      // Revert only if still pending (kid can undo mistakes before Mom approves)
      const { error } = await supabase
        .from("chore_completions")
        .delete()
        .eq("id", completionId)
        .eq("status", "PENDING_APPROVAL");

      if (error) throw new Error(error.message);

      setMsg("Submission reverted.");
      router.refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "Could not revert submission.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <button className="btn" disabled={busy} onClick={revert}>
        {busy ? "Reverting..." : "Revert Submission"}
      </button>
      {msg ? <div style={{ fontSize: 12, opacity: 0.8 }}>{msg}</div> : null}
    </div>
  );
}
