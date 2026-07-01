import type { ParsedCas } from "./casParser";
import { casHoldingDisplayName } from "./schemeNames";

export type LedgerTxn = {
  id: string;
  date: string;
  dateMs: number;
  fund: string;
  category: string;
  type: "Investment" | "Redemption";
  amount: number;
  units: string;
};

export type MonthlyLedger = {
  month: string;
  monthKey: string;
  totalInvested: number;
  totalRedeemed: number;
  txns: LedgerTxn[];
};

export type FundLedger = {
  fundKey: string;
  fund: string;
  invested: number;
  redeemed: number;
  totalUnits: number;
  currentValue: number;
  txns: LedgerTxn[];
};

function toNum(s?: string | null): number {
  const n = Number(String(s ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseCasDate(input?: string | null): Date | null {
  if (!input) return null;
  const s = input.trim();
  const d1 = new Date(s);
  if (!Number.isNaN(d1.getTime())) return d1;
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (!m) return null;
  const months: Record<string, number> = {
    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    may: 4,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    oct: 9,
    nov: 10,
    dec: 11,
  };
  const day = Number(m[1]);
  const mon = months[m[2].toLowerCase()];
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (!Number.isFinite(day) || mon == null || !Number.isFinite(year)) return null;
  return new Date(year, mon, day, 12, 0, 0, 0);
}

function fmtDisplayDate(d: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(d.getDate()).padStart(2, "0")} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function monthLabel(d: Date): string {
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

function txnCategory(desc: string): string {
  const d = desc.toLowerCase();
  if (d.includes("sip")) return "SIP";
  if (d.includes("redemption") || d.includes("redeem")) return "Redemption";
  if (d.includes("switch")) return "Switch";
  if (d.includes("dividend") || d.includes("idcw")) return "IDCW";
  return "Lumpsum";
}

function isRedemption(desc: string, amount: number): boolean {
  const d = desc.toLowerCase();
  if (d.includes("redemption") || d.includes("redeem") || d.includes("switch out")) return true;
  return amount < 0;
}

export function collectLedgerTxnsFromDocs(docs: ParsedCas[]): LedgerTxn[] {
  const out: LedgerTxn[] = [];
  let seq = 0;
  for (const doc of docs) {
    for (const h of doc.holdings ?? []) {
      const fund = casHoldingDisplayName(h);
      for (const tx of h.transactions ?? []) {
        const d = parseCasDate(tx.date);
        if (!d) continue;
        const desc = String(tx.description ?? "").trim();
        if (/opening\s+balance/i.test(desc)) continue;
        const rawAmount = toNum(tx.amount_inr);
        const amount = Math.abs(rawAmount);
        if (amount <= 0 && !toNum(tx.units)) continue;
        const redeem = isRedemption(desc, rawAmount);
        out.push({
          id: `tx-${seq++}`,
          date: fmtDisplayDate(d),
          dateMs: d.getTime(),
          fund,
          category: txnCategory(desc),
          type: redeem ? "Redemption" : "Investment",
          amount,
          units: String(tx.units ?? "").trim() || "—",
        });
      }
    }
  }
  return out.sort((a, b) => b.dateMs - a.dateMs);
}

export function buildMonthlyLedger(txns: LedgerTxn[]): MonthlyLedger[] {
  const byMonth = new Map<string, LedgerTxn[]>();
  for (const t of txns) {
    const d = new Date(t.dateMs);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const list = byMonth.get(key) ?? [];
    list.push(t);
    byMonth.set(key, list);
  }
  return [...byMonth.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([monthKey, list]) => {
      const sample = new Date(list[0]!.dateMs);
      let invested = 0;
      let redeemed = 0;
      for (const t of list) {
        if (t.type === "Redemption") redeemed += t.amount;
        else invested += t.amount;
      }
      return {
        month: monthLabel(sample),
        monthKey,
        totalInvested: invested,
        totalRedeemed: redeemed,
        txns: list.sort((a, b) => b.dateMs - a.dateMs),
      };
    });
}

/** Latest closing units per simplified fund name from CAS holdings. */
export function collectFundUnitsFromDocs(docs: ParsedCas[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const doc of docs) {
    for (const h of doc.holdings ?? []) {
      const fund = casHoldingDisplayName(h);
      const units = toNum(h.closing_units);
      if (units > 0) map.set(fund, (map.get(fund) ?? 0) + units);
    }
  }
  return map;
}

export function buildFundLedger(
  txns: LedgerTxn[],
  metaByFund?: Map<string, { totalUnits: number; currentValue: number }>,
): FundLedger[] {
  const byFund = new Map<string, LedgerTxn[]>();
  for (const t of txns) {
    const list = byFund.get(t.fund) ?? [];
    list.push(t);
    byFund.set(t.fund, list);
  }
  return [...byFund.entries()]
    .map(([fund, list]) => {
      let invested = 0;
      let redeemed = 0;
      for (const t of list) {
        if (t.type === "Redemption") redeemed += t.amount;
        else invested += t.amount;
      }
      const meta = metaByFund?.get(fund);
      return {
        fundKey: fund,
        fund,
        invested,
        redeemed,
        totalUnits: meta?.totalUnits ?? 0,
        currentValue: meta?.currentValue ?? 0,
        txns: list.sort((a, b) => b.dateMs - a.dateMs),
      };
    })
    .sort((a, b) => b.invested - a.invested);
}
