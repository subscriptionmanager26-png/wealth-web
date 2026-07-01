export type AmfiResolveTrace = {
  appendNow: (message: string) => void;
  runTimed: <T>(message: string, fn: () => Promise<T>) => Promise<T>;
  text: () => string;
};

function formatTraceTimestamp(d = new Date()): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** Strip third-party provider names from user-visible pipeline logs. */
function sanitizeProviderNames(message: string): string {
  return message
    .replace(/AMFI mapping/gi, "Source mapping")
    .replace(/AMFI history/gi, "source history")
    .replace(/AMFI portal/gi, "source portal")
    .replace(/already AMFI /gi, "already mapped ")
    .replace(/→ AMFI /gi, "→ scheme ")
    .replace(/Single strict name match → AMFI /gi, "Single strict name match → scheme ")
    .replace(/Resolved → AMFI /gi, "Resolved → scheme ")
    .replace(/Name cache → AMFI /gi, "Name cache → scheme ")
    .replace(/ISIN ([^→]+) → AMFI /gi, "ISIN $1 → scheme ")
    .replace(/AMFI /g, "Scheme ")
    .replace(/\bmfapi\b/gi, "source")
    .replace(/Upvaly/gi, "source");
}

export function createAmfiResolveTrace(onLine?: (line: string) => void): AmfiResolveTrace {
  const lines: string[] = [];
  const appendNow = (message: string) => {
    const line = `[${formatTraceTimestamp()}] ${sanitizeProviderNames(message)}`;
    lines.push(line);
    onLine?.(line);
  };
  return {
    appendNow,
    async runTimed<T>(message: string, fn: () => Promise<T>): Promise<T> {
      appendNow(`${message} — start`);
      const t0 = Date.now();
      try {
        return await fn();
      } finally {
        appendNow(`${message} — done (${Date.now() - t0} ms)`);
      }
    },
    text: () => lines.join("\n"),
  };
}
