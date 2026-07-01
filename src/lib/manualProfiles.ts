import type { Profile } from "./buildHoldings";
import { randId } from "./format";

const KEY = "wealth_web_manual_profiles_v1";

export function loadManualProfiles(): Profile[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Profile[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveManualProfiles(rows: Profile[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {
    /* ignore */
  }
}

export function createManualMember(name: string): Profile {
  return { id: randId(), name: name.trim(), total: 0, invested: 0, xirr: "0.0%" };
}

export function mergeCasAndManualProfiles(casProfiles: Profile[], manual: Profile[]): Profile[] {
  const casIds = new Set(casProfiles.map((p) => p.id));
  const casNames = new Set(casProfiles.map((p) => p.name.trim().toLowerCase()));
  const extra = manual.filter((m) => !casIds.has(m.id) && !casNames.has(m.name.trim().toLowerCase()));
  return [...casProfiles, ...extra];
}
