import { revalidatePath } from "next/cache";
import { createClient } from "../../../lib/supabase/server";
import { formatRs, toPaisaFromRs } from "../../../lib/money";

function normalizeDate(s: string | undefined, fallback: string) {
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallback;
}

export default async function PurchasesPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const supabase = await createClient();
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user!;

  const { data: roleRow } = await supabase
    .from("user_roles")
    .select("role,family_id,kid_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const role = roleRow?.role ?? "unknown";
  const familyId = roleRow?.family_id ?? "";
  const kidId = roleRow?.kid_id ?? null;

  const today = new Date();
  const endDefault = today.toISOString().slice(0, 10);
  const startDefault = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const start = normalizeDate(typeof searchParams.start === "string" ? searchParams.start : undefined, startDefault);
  const end = normalizeDate(typeof searchParams.end === "string" ? searchParams.end : undefined, endDefault);

  // NOTE: Do NOT filter by family_id in the UI. RLS scopes rows to the current family.
  // Filtering by an unset familyId can cause empty results.
  const { data: categories, error: categoriesErr } = await supabase
    .from("purchase_categories")
    .select("id,name")
    .order("name");

  const basePurchasesQ = supabase
    .from("purchases")
    .select("id,purchase_date,amount_cents,note,kid_id,category_id, purchase_categories(name)")
    .gte("purchase_date", start)
    .lte("purchase_date", end)
    .order("purchase_date", { ascending: false })
    .limit(200);

  const { data: purchases, error: purchasesErr } = role === "child" && kidId ? await basePurchasesQ.eq("kid_id", kidId) : await basePurchasesQ;

  const missingPurchasesSchema =
    (categoriesErr as any)?.code === "42P01" || (purchasesErr as any)?.code === "42P01";

  async function addPurchase(formData: FormData) {
    "use server";
    if (missingPurchasesSchema) {
      throw new Error("Purchases tables are not installed yet. Run supabase/migrations/0004_purchases_avatars.sql in Supabase SQL Editor.");
    }
    const amountRs = Number(formData.get("amount") ?? 0);
    const amount_cents = toPaisaFromRs(amountRs);
    const purchase_date = String(formData.get("purchase_date") ?? "").slice(0, 10);
    const note = String(formData.get("note") ?? "").trim() || null;
    const category_id = String(formData.get("category_id") ?? "") || null;

    const supabase = await createClient();
    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes.user;
    if (!user) throw new Error("Not signed in");

    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role,family_id,kid_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!roleRow?.family_id) throw new Error("No family");

    const kid_id = roleRow.role === "child" ? roleRow.kid_id : String(formData.get("kid_id") ?? "") || roleRow.kid_id;
    if (!kid_id) throw new Error("Kid required");
    if (!Number.isFinite(amount_cents) || amount_cents <= 0) throw new Error("Amount required");

    if (missingPurchasesSchema) throw new Error('Purchases schema is not installed. Run migration 0004_purchases_avatars.sql in Supabase SQL Editor.');

    const { error } = await supabase.from("purchases").insert({
      family_id: roleRow.family_id,
      kid_id,
      category_id,
      amount_cents,
      purchase_date: purchase_date || new Date().toISOString().slice(0, 10),
      note,
    });
    if (error) throw new Error(error.message);

    revalidatePath("/purchases");
    revalidatePath("/reports");
    revalidatePath("/dashboard");
  }

  async function addCategory(formData: FormData) {
    "use server";
    if (missingPurchasesSchema) {
      throw new Error("Purchase categories table is not installed yet. Run supabase/migrations/0004_purchases_avatars.sql in Supabase SQL Editor.");
    }
    const name = String(formData.get("name") ?? "").trim();
    if (!name) throw new Error("Name required");

    const supabase = await createClient();
    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes.user;
    if (!user) throw new Error("Not signed in");

    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role,family_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (roleRow?.role !== "parent") throw new Error("Parent only");
    if (!roleRow.family_id) throw new Error("No family");

    if (missingPurchasesSchema) throw new Error('Purchases schema is not installed. Run migration 0004_purchases_avatars.sql in Supabase SQL Editor.');

    const { error } = await supabase.from("purchase_categories").insert({ family_id: roleRow.family_id, name });
    if (error) throw new Error(error.message);

    revalidatePath("/purchases");
  }

  let kids: any[] = [];
  if (role === "parent") {
    const { data } = await supabase.from("kids").select("id,display_name").order("display_name");
    kids = data ?? [];
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div className="h2">Purchases</div>
          <div className="muted">Track spending from earned money. Use the date range to view any period.</div>
        </div>
        <form method="get" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input className="input" type="date" name="start" defaultValue={start} />
          <input className="input" type="date" name="end" defaultValue={end} />
          <button className="btn">Apply</button>
        </form>
      </div>

      <div className="card" style={{ padding: 14, display: "grid", gap: 10 }}>
        <div style={{ fontWeight: 900 }}>Add purchase</div>
        {missingPurchasesSchema ? (
          <div className="pill" style={{ background: "var(--sun-100)", fontWeight: 900 }}>
            Purchases feature is not enabled in your database yet. Run <b>supabase/migrations/0004_purchases_avatars.sql</b> in Supabase SQL Editor.
          </div>
        ) : null}
        <form
          action={addPurchase}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
            gap: 10,
            alignItems: "center",
            opacity: missingPurchasesSchema ? 0.6 : 1,
          }}
        >
          <fieldset disabled={missingPurchasesSchema} style={{ border: "none", padding: 0, margin: 0, display: "contents" }}>
          {role === "parent" ? (
            <select className="input" name="kid_id" defaultValue="" required>
              <option value="" disabled>Select kid</option>
              {kids.map((k) => (
                <option key={k.id} value={k.id}>{k.display_name}</option>
              ))}
            </select>
          ) : null}
          <input className="input" name="note" placeholder="What did you buy? (optional)" />
          <input className="input" name="amount" type="number" step="0.01" min="0" placeholder="Amount (Rs.)" required />
          <select className="input" name="category_id" defaultValue="">
            <option value="">Category (optional)</option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <input className="input" name="purchase_date" type="date" defaultValue={endDefault} />
          <button className="btn btnPrimary">Save</button>
          </fieldset>
        </form>
      </div>

      {role === "parent" ? (
        <div className="card" style={{ padding: 14, display: "grid", gap: 10 }}>
          <div style={{ fontWeight: 900 }}>Categories</div>
          <form action={addCategory} style={{ display: "flex", gap: 8, flexWrap: "wrap", opacity: missingPurchasesSchema ? 0.6 : 1 }}>
            <fieldset disabled={missingPurchasesSchema} style={{ border: "none", padding: 0, margin: 0, display: "contents" }}>
              <input className="input" name="name" placeholder="New category (e.g., Snacks)" required />
              <button className="btn">Add</button>
            </fieldset>
          </form>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(categories ?? []).map((c) => (
              <span key={c.id} className="pill">{c.name}</span>
            ))}
            {(categories ?? []).length === 0 ? <span className="muted">No categories yet.</span> : null}
          </div>
        </div>
      ) : null}

      <div className="card" style={{ padding: 14, display: "grid", gap: 10 }}>
        <div style={{ fontWeight: 900 }}>History</div>
        <div style={{ overflowX: "auto" }}>
          <table className="table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th>Date</th>
                {role === "parent" ? <th>Kid</th> : null}
                <th>Category</th>
                <th>Note</th>
                <th style={{ textAlign: "right" }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {(purchases ?? []).map((p: any) => (
                <tr key={p.id}>
                  <td>{p.purchase_date}</td>
                  {role === "parent" ? <td className="muted">{kids.find((k) => k.id === p.kid_id)?.display_name ?? "—"}</td> : null}
                  <td className="muted">{p.purchase_categories?.name ?? "—"}</td>
                  <td className="muted">{p.note ?? "—"}</td>
                  <td style={{ textAlign: "right", fontWeight: 900 }}>{formatRs(p.amount_cents)}</td>
                </tr>
              ))}
              {(purchases ?? []).length === 0 ? (
                <tr><td colSpan={role === "parent" ? 5 : 4} className="muted">No purchases in this period.</td></tr>
              ) : null}
            </tbody>
          </table></div>
        </div>
      </div>
  );
}