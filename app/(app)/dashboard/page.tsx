// app/(app)/dashboard/page.tsx
import { createClient } from "../../../lib/supabase/server";
import { formatRs } from "../../../lib/money";

export default async function DashboardPage() {
  const supabase = await createClient();

  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes?.user) {
    return (
      <div style={{ padding: 16 }}>
        <h1>Dashboard</h1>
        <p>Not signed in.</p>
      </div>
    );
  }
  const user = userRes.user;

  const { data: roleRow, error: roleErr } = await supabase
    .from("user_roles")
    .select("role,family_id,kid_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (roleErr || !roleRow) {
    return (
      <div style={{ padding: 16 }}>
        <h1>Dashboard</h1>
        <p style={{ opacity: 0.8 }}>
          Your account is missing a role assignment. Please add a row in{" "}
          <code>public.user_roles</code> for this user.
        </p>
      </div>
    );
  }

  const role = roleRow.role;
  const familyId = roleRow.family_id;
  const kidId = roleRow.kid_id;

  let q = supabase
    .from("ledger_transactions")
    .select(
      "amount_cents,spend_cents,charity_cents,invest_cents,parent_match_cents,source"
    )
    .eq("family_id", familyId)
    .eq("source", "CHORE_EARNING");

  if (role === "child") q = q.eq("kid_id", kidId);

  const { data: rows, error: rowsErr } = await q;
  if (rowsErr) {
    return (
      <div style={{ padding: 16 }}>
        <h1>Dashboard</h1>
        <p>Error loading ledger: {rowsErr.message}</p>
      </div>
    );
  }

  let earned = 0;
  let allowance = 0;
  let charity = 0;
  let invest = 0;
  let parentMatch = 0;

  for (const r of rows ?? []) {
    earned += r.amount_cents ?? 0;
    allowance += r.spend_cents ?? 0;
    charity += r.charity_cents ?? 0;
    invest += r.invest_cents ?? 0;
    parentMatch += r.parent_match_cents ?? 0;
  }

  const savings = invest - parentMatch;
  const parentPayable = earned + parentMatch;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <h1>Dashboard</h1>

      {role === "child" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 12,
          }}
        >
          <div className="tile">
            <b>Earned</b>
            <div className="amt">{formatRs(earned)}</div>
          </div>

          <div className="tile">
            <b>Allowance</b>
            <div className="amt">{formatRs(allowance)}</div>
          </div>

          <div className="tile">
            <b>Charity</b>
            <div className="amt">{formatRs(charity)}</div>
          </div>

          <div className="tile">
            <b>Savings</b>
            <div className="amt">{formatRs(savings)}</div>
          </div>

          <div className="tile">
            <b>Investment (Locked)</b>
            <div className="amt">{formatRs(invest)}</div>
          </div>

          <div style={{ gridColumn: "1 / -1", fontSize: 13, opacity: 0.7 }}>
            Earnings update only after Mom approves.
          </div>
        </div>
      )}

      {role === "parent" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 12,
          }}
        >
          <div className="tile">
            <b>Total Earned</b>
            <div>{formatRs(earned)}</div>
          </div>

          <div className="tile">
            <b>Allowance (Kids)</b>
            <div>{formatRs(allowance)}</div>
          </div>

          <div className="tile">
            <b>Charity</b>
            <div>{formatRs(charity)}</div>
          </div>

          <div className="tile">
            <b>Savings</b>
            <div>{formatRs(savings)}</div>
          </div>

          <div className="tile">
            <b>Investment</b>
            <div>{formatRs(invest)}</div>
          </div>

          <div className="tile">
            <b>Parent Match</b>
            <div>{formatRs(parentMatch)}</div>
          </div>

          <div className="tile">
            <b>Parent Payable</b>
            <div>{formatRs(parentPayable)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
