"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { rewards } from "@/lib/rewards";

type ChoreRow = {
  chore_id: string;
  title: string;
  price_rs: number; // kept for rewards only; not shown in UI
  approved_today: boolean;
  pending_today: boolean;
  pending_completion_id: string | null;
};

export default function ChoresClient({
  kidId,
  chores,
}: {
  kidId: string;
  chores: ChoreRow[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string>("");

  async function markComplete(choreId: string, amountRs: number) {
    setMsg("");
    setBusyId(choreId);

    try {
      const { error } = await supabase.rpc("record_chore_completion", {
        p_chore_id: choreId,
      });

      if (error) throw new Error(error.message);

      // Celebrate immediately (keeps kids engaged) even though approval is pending
      rewards.emit({ type: "coin_burst", amountRs });
      rewards.emit({ type: "confetti_small" });

      setMsg("Nice! Sent to Mom for approval.");
      router.refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "Could not submit chore.");
    } finally {
      setBusyId(null);
    }
  }

  async function undoPending(choreId: string, completionId: string) {
    setMsg("");
    setBusyId(choreId);

    try {
      const { error } = await supabase.rpc("kid_revert_pending_completion", {
        p_completion_id: completionId,
      });
      if (error) throw new Error(error.message);

      rewards.emit({ type: "confetti_small" });

      setMsg("Undone. You can submit it again if needed.");
      router.refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "Could not undo submission.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {msg ? (
        <div
          className="card"
          style={{
            padding: 12,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(76,29,149,0.10)",
          }}
        >
          {msg}
        </div>
      ) : null}

      <div style={{ display: "grid", gap: 10 }}>
        {chores.map((c) => {
          const isBusy = busyId === c.chore_id;

          let statusLabel = "Not done yet";
          let statusStyle: React.CSSProperties = {
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.10)",
          };

          if (c.approved_today) {
            statusLabel = "Approved ✅";
            statusStyle = {
              background: "rgba(34,211,238,0.12)",
              border: "1px solid rgba(34,211,238,0.35)",
            };
          } else if (c.pending_today) {
            statusLabel = "Waiting for Mom ⏳";
            statusStyle = {
              background: "rgba(250,204,21,0.12)",
              border: "1px solid rgba(250,204,21,0.35)",
            };
          }

          return (
            <div
              key={c.chore_id}
              className="tile"
              style={{
                padding: 14,
                borderRadius: 18,
                display: "grid",
                gap: 10,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "baseline",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "grid", gap: 4 }}>
                  <div style={{ fontWeight: 900, fontSize: 16 }}>
                    {c.title}
                  </div>
                </div>

                <div
                  style={{
                    padding: "6px 10px",
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 800,
                    ...statusStyle,
                  }}
                >
                  {statusLabel}
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {!c.approved_today && !c.pending_today ? (
                  <button
                    className="btn"
                    disabled={isBusy}
                    onClick={() => markComplete(c.chore_id, c.price_rs)}
                    style={{
                      borderRadius: 14,
                      padding: "10px 14px",
                      fontWeight: 900,
                    }}
                  >
                    {isBusy ? "Submitting..." : "Mark Complete"}
                  </button>
                ) : null}

                {c.pending_today && c.pending_completion_id ? (
                  <button
                    className="btn"
                    disabled={isBusy}
                    onClick={() =>
                      undoPending(c.chore_id, c.pending_completion_id!)
                    }
                    style={{
                      borderRadius: 14,
                      padding: "10px 14px",
                      fontWeight: 900,
                      background: "rgba(244,114,182,0.15)",
                      border: "1px solid rgba(244,114,182,0.35)",
                    }}
                  >
                    {isBusy ? "Undoing..." : "Undo"}
                  </button>
                ) : null}

                {c.approved_today ? (
                  <div style={{ opacity: 0.8, fontSize: 13, paddingTop: 8 }}>
                    Great job — approved!
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
