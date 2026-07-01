import type { ParsedCas } from "@mobile/utils/casParser";
import { casHoldingDisplayName } from "@mobile/utils/schemeNames";
import { fetchLiveNavByAmfi } from "@mobile/utils/livePortfolioNav";
import { parseCasDate, randId, toNum } from "./format";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_MS = 365 * ONE_DAY_MS;
const USE_LIVE_NAV_FOR_PORTFOLIO_VALUE = true;

export type Profile = {
  id: string;
  name: string;
  total: number;
  invested: number;
  xirr: string;
};

export type FundHolding = {
  id: string;
  profileId: string;
  name: string;
  rawName: string;
  amc: string;
  category: string;
  assetClass: "Equity" | "Debt" | "Hybrid";
  horizon: "Short Term" | "Long Term";
  invested: number;
  current: number;
  amount: number;
  returns: number;
  returnPct: number;
  totalUnits: number;
  unitsAbove12Months: number;
  planTag: "Direct" | "Regular" | null;
  payoutTag: "Growth" | "IDCW" | null;
  amfiCode?: string;
  priorDayCurrent?: number;
};

type CashFlow = { date: Date; amount: number };

function monthKeyFromDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function parseMonthKey(input?: string | null): string | null {
  const d = parseCasDate(input);
  return d ? monthKeyFromDate(d) : null;
}

function enumerateMonthKeys(from?: string | null, to?: string | null): string[] {
  const start = parseCasDate(from);
  const end = parseCasDate(to);
  if (!start || !end || end.getTime() < start.getTime()) return [];
  const keys: string[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cur.getTime() <= last.getTime()) {
    keys.push(monthKeyFromDate(cur));
    cur.setMonth(cur.getMonth() + 1);
  }
  return keys;
}

function addCashFlow(bucket: Map<string, CashFlow>, date: Date, amount: number) {
  if (!Number.isFinite(amount) || amount === 0) return;
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const prev = bucket.get(key);
  if (prev) prev.amount += amount;
  else bucket.set(key, { date: d, amount });
}

function solveXirr(flowsRaw: CashFlow[]): number | null {
  const flows = flowsRaw
    .filter((f) => Number.isFinite(f.amount) && f.amount !== 0)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  if (flows.length < 2) return null;
  if (!flows.some((f) => f.amount > 0) || !flows.some((f) => f.amount < 0)) return null;

  const t0 = flows[0]!.date.getTime();
  const years = (d: Date) => (d.getTime() - t0) / YEAR_MS;
  const npv = (r: number) => flows.reduce((sum, f) => sum + f.amount / Math.pow(1 + r, years(f.date)), 0);
  const dnpv = (r: number) =>
    flows.reduce((sum, f) => {
      const y = years(f.date);
      return sum - (y * f.amount) / Math.pow(1 + r, y + 1);
    }, 0);

  let r = 0.12;
  for (let i = 0; i < 50; i += 1) {
    if (r <= -0.999999) r = -0.999999;
    const f = npv(r);
    const df = dnpv(r);
    if (!Number.isFinite(f) || !Number.isFinite(df) || Math.abs(df) < 1e-12) break;
    const next = r - f / df;
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - r) < 1e-10) return next;
    r = next;
  }

  let lo = -0.9999;
  let hi = 10;
  let flo = npv(lo);
  let fhi = npv(hi);
  for (let k = 0; k < 20 && flo * fhi > 0; k += 1) {
    hi *= 2;
    fhi = npv(hi);
    if (!Number.isFinite(fhi) || hi > 1_000_000) break;
  }
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null;

  for (let i = 0; i < 120; i += 1) {
    const mid = (lo + hi) / 2;
    const fmid = npv(mid);
    if (!Number.isFinite(fmid)) return null;
    if (Math.abs(fmid) < 1e-9 || Math.abs(hi - lo) < 1e-10) return mid;
    if (flo * fmid <= 0) {
      hi = mid;
      fhi = fmid;
    } else {
      lo = mid;
      flo = fmid;
    }
  }
  return (lo + hi) / 2;
}

function formatXirrFromFlows(flows: CashFlow[]): string {
  const rate = solveXirr(flows);
  return rate == null || !Number.isFinite(rate) ? "0.0%" : `${(rate * 100).toFixed(1)}%`;
}

function classifyAsset(categoryOrName: string): "Equity" | "Debt" | "Hybrid" {
  const t = categoryOrName.toLowerCase();
  if (/(liquid|debt|bond|gilt|money|short duration|ultra short|corporate bond|credit risk)/.test(t)) return "Debt";
  if (/(hybrid|balanced|multi asset|aggressive hybrid|conservative hybrid|arbitrage)/.test(t)) return "Hybrid";
  return "Equity";
}

function inferCategory(name: string): string {
  const t = name.toLowerCase();
  if (t.includes("small cap")) return "Small Cap";
  if (t.includes("mid cap")) return "Mid Cap";
  if (t.includes("large cap")) return "Large Cap";
  if (t.includes("flexi")) return "Flexi Cap";
  if (t.includes("index")) return "Index";
  if (t.includes("liquid")) return "Liquid";
  if (t.includes("hybrid") || t.includes("balanced")) return "Hybrid";
  return "Other";
}

function extractSchemeTags(name: string): { planTag: FundHolding["planTag"]; payoutTag: FundHolding["payoutTag"] } {
  const s = name.toLowerCase();
  const planTag = s.includes("direct") ? "Direct" : s.includes("regular") ? "Regular" : null;
  const payoutTag = /(idcw|dividend|payout|reinvestment)/.test(s) ? "IDCW" : s.includes("growth") ? "Growth" : null;
  return { planTag, payoutTag };
}

export async function buildHoldingsFromParsedFiles(
  parsedDocs: ParsedCas[],
  options?: { skipLiveNav?: boolean },
): Promise<{ profiles: Profile[]; holdings: FundHolding[]; familyXirr: string }> {
  type Holder = {
    id: string;
    profileId: string;
    rawName: string;
    name: string;
    amc: string;
    category: string;
    assetClass: FundHolding["assetClass"];
    horizon: FundHolding["horizon"];
    current: number;
    invested: number;
    totalUnits: number;
    unitsAbove12Months: number;
    snapshotTs: number;
    planTag: FundHolding["planTag"];
    payoutTag: FundHolding["payoutTag"];
    amfiCode?: string;
  };

  const docs = [...parsedDocs].sort((a, b) => {
    const af = parseCasDate(a.period_from)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bf = parseCasDate(b.period_from)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return af - bf;
  });

  const ownerByMonth = new Map<string, number>();
  for (let i = 0; i < docs.length; i += 1) {
    const d = docs[i];
    const keys = enumerateMonthKeys(d.period_from, d.period_to);
    for (const k of keys) {
      if (!ownerByMonth.has(k)) ownerByMonth.set(k, i);
    }
  }

  const profilesByName = new Map<string, Profile>();
  const merged = new Map<string, Holder>();
  const flowByProfile = new Map<string, Map<string, CashFlow>>();
  const terminalDateByProfile = new Map<string, Date>();
  const cutoff = Date.now() - 365 * ONE_DAY_MS;

  for (let i = 0; i < docs.length; i += 1) {
    const parsed = docs[i];
    const memberName = parsed.investor_name?.trim() || "Member";
    const memberKey = memberName.toLowerCase();
    if (!profilesByName.has(memberKey)) {
      profilesByName.set(memberKey, { id: randId(), name: memberName, total: 0, invested: 0, xirr: "0.0%" });
    }
    const profile = profilesByName.get(memberKey)!;
    const snapshotTs = parseCasDate(parsed.period_to)?.getTime() ?? 0;
    const snapshotDate = parseCasDate(parsed.period_to);
    if (snapshotDate) {
      const prev = terminalDateByProfile.get(profile.id);
      if (!prev || snapshotDate.getTime() > prev.getTime()) terminalDateByProfile.set(profile.id, snapshotDate);
    }
    if (!flowByProfile.has(profile.id)) flowByProfile.set(profile.id, new Map<string, CashFlow>());

    for (const h of parsed.holdings ?? []) {
      const rawName = h.scheme_name?.trim() || "Fund";
      const name = casHoldingDisplayName(h);
      const { planTag, payoutTag } = extractSchemeTags(rawName);
      const amc = h.amc?.trim() || "Unknown AMC";
      const holdingKey = `${profile.id}::${h.folio_no || ""}::${rawName.toLowerCase()}`;
      const current = toNum(h.market_value_inr);
      const invested = toNum(h.cost_value_inr);
      const totalUnits = toNum(h.closing_units);
      const category = inferCategory(name);
      const assetClass = classifyAsset(`${category} ${name}`);
      const horizon: FundHolding["horizon"] = assetClass === "Debt" ? "Short Term" : "Long Term";

      if (!merged.has(holdingKey)) {
        merged.set(holdingKey, {
          id: randId(),
          profileId: profile.id,
          rawName,
          name,
          amc,
          category,
          assetClass,
          horizon,
          current,
          invested,
          totalUnits,
          unitsAbove12Months: 0,
          snapshotTs,
          planTag,
          payoutTag,
          amfiCode: h.mf_amfi_code?.trim() || undefined,
        });
      } else {
        const item = merged.get(holdingKey)!;
        if (snapshotTs >= item.snapshotTs) {
          item.snapshotTs = snapshotTs;
          item.current = current;
          item.invested = invested;
          item.totalUnits = totalUnits;
          item.amc = amc;
          item.rawName = rawName;
          item.name = name;
          item.category = category;
          item.assetClass = assetClass;
          item.horizon = horizon;
          item.planTag = planTag;
          item.payoutTag = payoutTag;
          const ac = h.mf_amfi_code?.trim();
          if (ac) item.amfiCode = ac;
        }
      }

      const target = merged.get(holdingKey)!;
      for (const tx of h.transactions ?? []) {
        const mk = parseMonthKey(tx.date);
        if (!mk || ownerByMonth.get(mk) !== i) continue;
        const txDate = parseCasDate(tx.date);
        if (txDate) {
          addCashFlow(flowByProfile.get(profile.id)!, txDate, -toNum(tx.amount_inr));
        }
        const units = toNum(tx.units);
        if (units <= 0) continue;
        if (!txDate || txDate.getTime() > cutoff) continue;
        target.unitsAbove12Months += units;
      }
    }
  }

  const profiles = [...profilesByName.values()];
  const holdings: FundHolding[] = [...merged.values()].map((m) => {
    const returnPct = m.invested > 0 ? (m.current / m.invested - 1) * 100 : 0;
    return {
      id: m.id,
      profileId: m.profileId,
      name: m.name,
      rawName: m.rawName,
      amc: m.amc,
      category: m.category,
      assetClass: m.assetClass,
      horizon: m.horizon,
      invested: m.invested,
      current: m.current,
      amount: m.current,
      returns: m.current - m.invested,
      returnPct,
      totalUnits: m.totalUnits,
      unitsAbove12Months: Math.min(m.totalUnits, Math.max(0, m.unitsAbove12Months)),
      planTag: m.planTag,
      payoutTag: m.payoutTag,
      amfiCode: m.amfiCode,
    };
  });

  if (USE_LIVE_NAV_FOR_PORTFOLIO_VALUE && !options?.skipLiveNav) {
    const amfiCodes = holdings.map((h) => h.amfiCode || "").filter((s): s is string => /^\d+$/.test(s));
    const navMap = await fetchLiveNavByAmfi(amfiCodes);
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const navMapPrior = await fetchLiveNavByAmfi(amfiCodes, yesterday);
    for (const h of holdings) {
      const amfi = (h.amfiCode || "").trim();
      const nav = navMap[amfi]?.nav;
      if (!amfi || !Number.isFinite(nav) || nav <= 0 || h.totalUnits <= 0) {
        h.priorDayCurrent = h.current;
        continue;
      }
      const current = h.totalUnits * nav;
      h.current = current;
      h.amount = current;
      h.returns = current - h.invested;
      h.returnPct = h.invested > 0 ? (current / h.invested - 1) * 100 : 0;
      const navPrior = navMapPrior[amfi]?.nav;
      h.priorDayCurrent =
        navPrior && Number.isFinite(navPrior) && navPrior > 0 ? h.totalUnits * navPrior : current;
    }
  } else {
    for (const h of holdings) h.priorDayCurrent = h.current;
  }

  const totalByProfile = new Map<string, number>();
  for (const h of holdings) {
    totalByProfile.set(h.profileId, (totalByProfile.get(h.profileId) ?? 0) + h.current);
  }
  const familyFlowBucket = new Map<string, CashFlow>();
  for (const profile of profiles) {
    const bucket = flowByProfile.get(profile.id) ?? new Map<string, CashFlow>();
    addCashFlow(bucket, terminalDateByProfile.get(profile.id) ?? new Date(), totalByProfile.get(profile.id) ?? 0);
    profile.xirr = formatXirrFromFlows([...bucket.values()]);
    profile.total = totalByProfile.get(profile.id) ?? 0;
    profile.invested = holdings.filter((h) => h.profileId === profile.id).reduce((a, h) => a + h.invested, 0);
    for (const cf of bucket.values()) addCashFlow(familyFlowBucket, cf.date, cf.amount);
  }

  return { profiles, holdings, familyXirr: formatXirrFromFlows([...familyFlowBucket.values()]) };
}
