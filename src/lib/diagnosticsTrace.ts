import type { AmfiResolveTrace } from "@mobile/utils/amfiResolveTrace";

function formatTraceTimestamp(d = new Date()): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/** Raw resolver trace for engineering diagnostics (no provider-name sanitization). */
export function createDiagnosticsMappingTrace(onLine?: (line: string) => void): AmfiResolveTrace {
  const lines: string[] = [];
  const appendNow = (message: string) => {
    const line = `[${formatTraceTimestamp()}] ${message}`;
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
