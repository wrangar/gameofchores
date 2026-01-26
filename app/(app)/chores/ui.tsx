"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { formatRs } from "@/lib/money";
import { rewards } from "@/lib/rewards";

type ChoreRow = {
  id: string;
  title: string;
  price_cents: number;
  status?: string | null;
  completion_id?: string | null;
};

export default function ChoresClient({
  kidId, // kept for compatibility with page.tsx (even if not used here)
  chores,
}: {
  kidId: string | null;
  chores: ChoreRow[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function submit(choreId: string) {
    setMsg(null);
    setBusyId(choreId);

    try {
      const { error } = await supabase.rpc("record_chore_completion", {
        p_chore_id: choreId,
      });

      if (error) throw new Error(error.message);

      rewards.emit({ type: "confetti_small" });

      setMsg("Submitted for approval. Mom will approve it soon.");
      router.refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "Could not submit chore.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {msg ? (
        <div className="tile" style={{ opacity: 0.9 }}>
          {msg}
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 10 }}>
        {chores.map((c) => {
          const pending = c.status === "PENDING_APPROVAL";
          const approved = c.status === "APPROVED";

          return (
            <div
              key={c.id}
              className="tile"
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                alignItems: "center",
              }}
            >
              <div style={{ display: "grid", gap: 4 }}>
                <div style={{ fontWeight: 800 }}>{c.title}</div>
                <div style={{ fontSize: 12, opacity: 0.75 }}>
                  {formatRs(c.price_cents)} ·{" "}
                  {approved
                    ? "Approved"
                    : pending
                    ? "Pending approval"
                    : "Not done yet"}
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                {!approved && !pending ? (
                  <button
                    className="btn"
                    disabled={busyId === c.id}
                    onClick={() => submit(c.id)}
                  >
                    {busyId === c.id ? "Submitting..." : "Mark Complete"}
                  </button>
                ) : null}

                {pending && c.completion_id ? (
                  <ChoreActions completionId={c.completion_id} />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ChoreActions({ completionId }: { completionId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function revert() {
    setMsg(null);
    setBusy(true);

    try {
      const { error } = await supabase
        .from("chore_completions")
        .delete()
        .eq("id", completionId)
        .eq("status", "PENDING_APPROVAL");

      if (error) throw new Error(error.message);

      rewards.emit({ type: "toast", message: "Reverted" });

      setMsg("Submission reverted.");
      router.refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "Could not revert submission.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <button className="btn" disabled={busy} onClick={revert}>
        {busy ? "Reverting..." : "Revert"}
      </button>
      {msg ? <div style={{ fontSize: 12, opacity: 0.75 }}>{msg}</div> : null}
    </div>
  );
}
