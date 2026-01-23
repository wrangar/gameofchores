"use client";

import React, { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type Mode = "none" | "daily" | "manual";

export default function ScheduleGrid({
  kids,
  chores,
  modeMap,
  setAssignment,
  selectedDate,
}: {
  kids: Array<{ id: string; display_name: string; avatar_emoji?: string | null; theme_color?: string | null }>;
  chores: Array<{ id: string; title: string }>;
  modeMap: Record<string, Mode>;
  setAssignment: (formData: FormData) => Promise<void>;
  selectedDate: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [date, setDate] = useState(selectedDate);

  // Optimistic client state so changes reflect immediately (no refresh needed to see the new mode).
  const [localMap, setLocalMap] = useState<Record<string, Mode>>(modeMap);

  // When the server re-renders with a new date or new assignments, sync optimistic state.
  useEffect(() => {
    setLocalMap(modeMap);
  }, [modeMap, selectedDate]);

  useEffect(() => {
    setDate(selectedDate);
  }, [selectedDate]);

  const setMode = (kidId: string, choreId: string, mode: Mode) => {
    const key = `${kidId}:${choreId}`;
    setLocalMap((prev) => {
      const next = { ...prev };
      if (mode === "none") delete next[key];
      else next[key] = mode;
      return next;
    });
  };

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <label className="pill" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontWeight: 800 }}>Select date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => {
              const next = e.target.value;
              setDate(next);
              // keep URL in sync so server modeMap reflects the selected date
              router.replace(`/admin/assignments?date=${next}`);
              router.refresh();
            }}
            style={{ border: 'none', background: 'transparent' }}
          />
        </label>
        <div className="muted" style={{ fontSize: 13 }}>
          Manual assignments apply only to the selected date.
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
      <table className="table" style={{ minWidth: 820 }}>
        <thead>
          <tr>
            <th style={{ width: 220 }}>Kid</th>
            {chores.map((c) => (
              <th key={c.id} style={{ textAlign: "center", minWidth: 160 }}>
                {c.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {kids.map((k) => (
            <tr key={k.id}>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div className="avatar" style={{ background: k.theme_color ?? undefined }}>
                    <span style={{ fontSize: 18 }}>{k.avatar_emoji ?? "🙂"}</span>
                  </div>
                  <div style={{ fontWeight: 800 }}>{k.display_name}</div>
                </div>
              </td>

              {chores.map((c) => {
                const key = `${k.id}:${c.id}`;
                const current = localMap[key] ?? "none";
                const bg =
                  current === "daily" ? "var(--mint-100)" : current === "manual" ? "var(--sun-100)" : "transparent";

                return (
                  <td key={c.id} style={{ textAlign: "center" }}>
                    <select
                      value={current}
                      className="pill"
                      style={{ background: bg, opacity: isPending ? 0.7 : 1 }}
                      disabled={isPending}
                      onChange={(e) => {
                        const mode = e.target.value as Mode;
                        // 1) optimistic update
                        setMode(k.id, c.id, mode);

                        // 2) persist
                        startTransition(async () => {
                          const fd = new FormData();
                          fd.set("kid_id", k.id);
                          fd.set("chore_id", c.id);
                          fd.set("mode", mode);
                          fd.set("date", date);
                          await setAssignment(fd);
                          router.refresh();
                        });
                      }}
                    >
                      <option value="none">Off</option>
                      <option value="daily">Daily</option>
                      <option value="manual">Manual</option>
                    </select>
                  </td>
                );
              })}
            </tr>
          ))}
          {kids.length === 0 ? (
            <tr>
              <td colSpan={1 + chores.length} className="muted">
                No kids found.
              </td>
            </tr>
          ) : null}
          {chores.length === 0 ? (
            <tr>
              <td colSpan={1 + chores.length} className="muted">
                No active chores found. Create chores in “Manage Chores”.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      </div>
    </div>
  );
}
