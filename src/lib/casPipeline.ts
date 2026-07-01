import type { ParsedCas } from "@mobile/utils/casParser";
import { safeLocalStorageSet } from "./safeLocalStorage";
import { pendingResolvableAmfiCount, totalPendingResolvableAmfiAcrossDocs } from "../bridge/amfiSchemeMap.web";
import type { SavedParsedCasFile } from "../lib/casLibrary";

export type CasPipelineMilestones = {
  savedAt?: string;
  parsedAt?: string;
  amfiMappedAt?: string;
  amfiCheckedAt?: string;
  navFinishedAt?: string;
  /** IST date key (YYYY-MM-DD) for capped auto AMFI retries on hydrate. */
  amfiAutoRetryDay?: string;
  amfiAutoRetryCount?: number;
};

export type PipelineStepStatus = "ok" | "pending" | "partial" | "error" | "loading";

export type PipelineStep = {
  key: string;
  title: string;
  status: PipelineStepStatus;
  detail?: string;
  at?: string;
};

const STORE_PIPELINE_MILESTONES = "cas_pipeline_milestones_v1";

export function loadPipelineMilestones(): CasPipelineMilestones {
  try {
    const raw = localStorage.getItem(STORE_PIPELINE_MILESTONES);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as CasPipelineMilestones;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function savePipelineMilestones(m: CasPipelineMilestones): boolean {
  return safeLocalStorageSet(STORE_PIPELINE_MILESTONES, JSON.stringify(m));
}

function formatIsoDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export function buildCasPipelineSteps(input: {
  savedCasFiles: SavedParsedCasFile[];
  savedParsedDocs: ParsedCas[];
  milestones: CasPipelineMilestones;
  uploadBusy: boolean;
  amfiMappingBusy: boolean;
  analyticsLoading: boolean;
  hydrating: boolean;
  holdingsCount: number;
  navStatus: "none" | "loading" | "ok" | "empty" | "error";
  navDetail?: string;
}): PipelineStep[] {
  const {
    savedCasFiles,
    savedParsedDocs,
    milestones,
    uploadBusy,
    amfiMappingBusy,
    analyticsLoading,
    hydrating,
    holdingsCount,
    navStatus,
    navDetail,
  } = input;

  const hasUploads = savedCasFiles.length > 0 || !!milestones.savedAt || holdingsCount > 0;
  const lastUploadedIso = savedCasFiles.length
    ? savedCasFiles.reduce((m, f) => (f.addedAt > m ? f.addedAt : m), savedCasFiles[0]!.addedAt)
    : milestones.savedAt ?? null;

  const indexCount = savedCasFiles.length;
  const parsedCount = savedParsedDocs.length;
  const allParsedOk = hasUploads && parsedCount === indexCount && indexCount > 0;
  const parseConfirmed =
    allParsedOk || (!!milestones.parsedAt && holdingsCount > 0 && !hydrating);

  let uploadStatus: PipelineStepStatus;
  if (!hasUploads && uploadBusy) uploadStatus = "loading";
  else if (!hasUploads) uploadStatus = "pending";
  else uploadStatus = "ok";

  let savedStatus: PipelineStepStatus;
  if (!hasUploads) savedStatus = "pending";
  else if (hydrating && !milestones.savedAt) savedStatus = "loading";
  else if (uploadBusy && !milestones.savedAt) savedStatus = "loading";
  else savedStatus = "ok";

  let parseStatus: PipelineStepStatus;
  if (!hasUploads) parseStatus = "pending";
  else if (hydrating && !parseConfirmed) parseStatus = "loading";
  else if (uploadBusy && !parseConfirmed) parseStatus = "loading";
  else if (parseConfirmed) parseStatus = "ok";
  else if (!hydrating && parsedCount === 0) parseStatus = "error";
  else parseStatus = "partial";

  const parseDetail =
    parseStatus === "partial"
      ? `${parsedCount} of ${indexCount} saved CAS files loaded (${indexCount - parsedCount} missing or corrupt).`
      : parseStatus === "error"
        ? "Could not read parsed CAS data."
        : undefined;

  const pendingAmfi =
    !hydrating && savedParsedDocs.length ? totalPendingResolvableAmfiAcrossDocs(savedParsedDocs) : 0;
  const amfiMappedConfirmed = !!milestones.amfiMappedAt && pendingAmfi === 0;

  let amfiStatus: PipelineStepStatus;
  if (!parseConfirmed) amfiStatus = hydrating ? "loading" : "pending";
  else if (amfiMappingBusy) amfiStatus = "loading";
  else if (amfiMappedConfirmed || (pendingAmfi === 0 && parseConfirmed)) amfiStatus = "ok";
  else if (pendingAmfi > 0) amfiStatus = "partial";
  else amfiStatus = hydrating ? "loading" : "pending";

  const amfiDetail =
    amfiStatus === "loading"
      ? pendingAmfi > 0
        ? `Mapping scheme codes (${pendingAmfi} holding line(s) still open)…`
        : "Mapping scheme codes…"
      : amfiStatus === "partial"
        ? `${pendingAmfi} holding line(s) still need a scheme code. Use Retry mapping below.`
        : undefined;

  let navStepStatus: PipelineStepStatus;
  if (!parseConfirmed) navStepStatus = hydrating ? "loading" : "pending";
  else if (analyticsLoading || navStatus === "loading") navStepStatus = "loading";
  else if (navStatus === "ok" || !!milestones.navFinishedAt) navStepStatus = "ok";
  else if (hydrating) navStepStatus = "loading";
  else if (amfiMappingBusy) navStepStatus = "loading";
  else if (pendingAmfi > 0 && navStatus === "none") navStepStatus = "pending";
  else if (navStatus === "none") navStepStatus = "pending";
  else if (navStatus === "empty") navStepStatus = "partial";
  else navStepStatus = "error";

  const navStepDetail =
    navStepStatus === "loading" && !analyticsLoading
      ? "Computing portfolio NAV…"
      : navStepStatus === "pending" && pendingAmfi > 0
        ? `${pendingAmfi} scheme(s) still unmapped — NAV uses mapped holdings only. Retry mapping or refresh NAV.`
        : navDetail;

  return [
    { key: "upload", title: "CAS uploaded", status: uploadStatus, at: lastUploadedIso ?? undefined },
    {
      key: "saved",
      title: "CAS saved",
      status: savedStatus,
      at: milestones.savedAt ?? (hasUploads ? lastUploadedIso ?? undefined : undefined),
    },
    {
      key: "parse",
      title: "CAS parsed",
      status: parseStatus,
      detail: parseDetail,
      at: milestones.parsedAt ?? (allParsedOk ? lastUploadedIso ?? undefined : undefined),
    },
    {
      key: "amfi",
      title: "Source mapping complete",
      status: amfiStatus,
      detail: amfiDetail,
      at:
        amfiStatus === "ok" || amfiMappedConfirmed
          ? milestones.amfiMappedAt ?? milestones.amfiCheckedAt
          : milestones.amfiCheckedAt,
    },
    {
      key: "nav",
      title: "Portfolio NAV calculated",
      status: navStepStatus,
      detail: navStepDetail,
      at: milestones.navFinishedAt,
    },
  ];
}

export function statusLabel(status: PipelineStepStatus): string {
  if (status === "ok") return "OK";
  if (status === "error") return "Error";
  if (status === "loading") return "Running";
  if (status === "partial") return "Incomplete";
  return "Pending";
}

export function statusColor(status: PipelineStepStatus): string {
  if (status === "ok") return "var(--positive)";
  if (status === "error") return "var(--negative)";
  if (status === "loading") return "var(--text-secondary)";
  if (status === "partial") return "#f59e0b";
  return "var(--text-muted)";
}

export { formatIsoDateTime, pendingResolvableAmfiCount };
