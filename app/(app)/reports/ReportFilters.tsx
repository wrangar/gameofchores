"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function ReportFilters({ defaultFrom, defaultTo }: { defaultFrom: string; defaultTo: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const initialFrom = sp.get("from") ?? defaultFrom;
  const initialTo = sp.get("to") ?? defaultTo;

  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);

  const presets = useMemo(() => {
    const today = new Date();
    const startMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const startWeek = new Date(today);
    startWeek.setDate(today.getDate() - ((today.getDay() + 6) % 7)); // Monday

    const ytd = new Date(today.getFullYear(), 0, 1);
    return {
      today: { from: iso(today), to: iso(today) },
      week: { from: iso(startWeek), to: iso(today) },
      mtd: { from: iso(startMonth), to: iso(today) },
      ytd: { from: iso(ytd), to: iso(today) },
    };
  }, []);

  const apply = (f: string, t: string) => {
    startTransition(() => {
      const params = new URLSearchParams(sp.toString());
      params.set("from", f);
      params.set("to", t);
      router.push(`/reports?${params.toString()}`);
      router.refresh();
    });
  };

  return (
    <div className="card" style={{ padding: 12, display: "grid", gap: 10 }}>
      <div style={{ fontWeight: 900 }}>Report period</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        <label style={{ display: "grid", gap: 6 }}>
          <span className="muted" style={{ fontSize: 13 }}>Start date</span>
          <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label style={{ display: "grid", gap: 6 }}>
          <span className="muted" style={{ fontSize: 13 }}>End date</span>
          <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
          <button className="btn" disabled={isPending} onClick={() => apply(from, to)}>
            Run report
          </button>
          <button className="btn" disabled={isPending} onClick={() => { setFrom(presets.mtd.from); setTo(presets.mtd.to); apply(presets.mtd.from, presets.mtd.to); }}>
            Month-to-date
          </button>
          <button className="btn" disabled={isPending} onClick={() => { setFrom(presets.week.from); setTo(presets.week.to); apply(presets.week.from, presets.week.to); }}>
            This week
          </button>
          <button className="btn" disabled={isPending} onClick={() => { setFrom(presets.today.from); setTo(presets.today.to); apply(presets.today.from, presets.today.to); }}>
            Today
          </button>
        </div>
      </div>
    </div>
  );
}
