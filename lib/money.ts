export type MoneyFormatOptions = {
  showDecimals?: boolean;
};

/**
 * Amounts are stored as integers.
 * For gameofchores.fun we use whole Rupees only (no decimals).
 */
export function formatRs(amountRs: number, _opts: MoneyFormatOptions = {}) {
  const value = Number(amountRs) || 0;
  const formatted = new Intl.NumberFormat('en-PK', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
  return `Rs. ${formatted}`;
}

export function toPaisaFromRs(rs: number) {
  // Backward-compatible helper; now returns whole rupees.
  const n = Number(rs);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}
