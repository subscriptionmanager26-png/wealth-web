/** Local calendar day key (device timezone). */
export function localDayKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export type AutomaticExtractDecision = {
  shouldRun: boolean;
  pendingSessions: number;
  reason:
    | "due"
    | "no_pending"
    | "already_ran_today"
    | "already_running"
    | "no_api_key"
    | "manual_only";
  lastAutomaticExtractDay: string | null;
  lastExtractAt: string | null;
};

export function automaticExtractStatusMessage(decision: AutomaticExtractDecision): string {
  switch (decision.reason) {
    case "due":
      return `${decision.pendingSessions} conversation(s) queued — automatic processing will run once today.`;
    case "no_pending":
      return "No new conversations to process. Chat first, then memory updates once per day.";
    case "already_ran_today":
      return `Automatic processing already ran today (${decision.lastAutomaticExtractDay}). Use “Process now” to run again manually.`;
    case "already_running":
      return "Memory processing is already in progress.";
    case "no_api_key":
      return "Add a Mistral API key to enable background memory.";
    case "manual_only":
      return "Automatic run skipped.";
    default:
      return "";
  }
}
