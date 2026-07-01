import type { ParsedCAS } from "../parser/cas-parser";

export type CasInvestorProfile = {
  id: string;
  name: string;
  pan: string | null;
  email: string | null;
  mobile: string | null;
  address: string | null;
  updatedAt: string;
};

function normPan(pan: string | null | undefined): string | null {
  const p = (pan ?? "").trim().toUpperCase();
  return /^[A-Z]{5}\d{4}[A-Z]$/.test(p) ? p : null;
}

/** Stable key so multiple CAS statements for the same person merge into one profile. */
export function investorDedupeKey(doc: ParsedCAS): string {
  const pan = normPan(doc.investor_pan);
  if (pan) return `pan:${pan}`;
  const name = (doc.investor_name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const email = (doc.email ?? "").trim().toLowerCase();
  if (name && email) return `ne:${name}|${email}`;
  if (name) return `name:${name}`;
  if (email) return `email:${email}`;
  return `doc:${(doc.source_file ?? "").trim()}|${doc.period_from ?? ""}|${doc.period_to ?? ""}`;
}

export function mergeUniqueInvestorsFromCasDocs(docs: ParsedCAS[]): CasInvestorProfile[] {
  const byKey = new Map<string, CasInvestorProfile>();
  for (const doc of docs) {
    const key = investorDedupeKey(doc);
    const updatedAt = doc.period_to ?? doc.period_from ?? "";
    const incoming: CasInvestorProfile = {
      id: key,
      name: (doc.investor_name ?? "").trim() || "Unknown investor",
      pan: normPan(doc.investor_pan),
      email: (doc.email ?? "").trim() || null,
      mobile: (doc.mobile ?? "").trim() || null,
      address: (doc.address ?? "").trim() || null,
      updatedAt,
    };
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, incoming);
      continue;
    }
    const useIncoming = updatedAt >= prev.updatedAt;
    const base = useIncoming ? incoming : prev;
    const other = useIncoming ? prev : incoming;
    byKey.set(key, {
      ...base,
      pan: base.pan ?? other.pan,
      email: base.email ?? other.email,
      mobile: base.mobile ?? other.mobile,
      address: base.address ?? other.address,
      name: base.name || other.name,
      updatedAt: updatedAt >= prev.updatedAt ? updatedAt : prev.updatedAt,
    });
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
}
