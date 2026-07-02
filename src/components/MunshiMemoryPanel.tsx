import { useCallback, useEffect, useState } from "react";

import { refreshMemoryStatus, type MemoryJobProgress } from "../lib/munshiMemoryScheduler";
import { localDayKey } from "../lib/munshiMemorySchedulePolicy";
import {
  memoryDeleteDaySummary,
  memoryListDaySummaries,
  memoryListLearnings,
  memoryListRules,
  memorySetLearningActive,
  memorySetRuleActive,
} from "../lib/munshiMemoryDb";
import type { MunshiDaySummary, MunshiLearning, MunshiRule } from "../lib/munshiMemoryTypes";

type Props = {
  memoryJob: MemoryJobProgress;
  onRunMemoryNow: () => void | Promise<void>;
  hasApiKey: boolean;
};

export function MunshiMemoryPanel({ memoryJob, onRunMemoryNow, hasApiKey }: Props) {
  const [summaries, setSummaries] = useState<MunshiDaySummary[]>([]);
  const [learnings, setLearnings] = useState<MunshiLearning[]>([]);
  const [rules, setRules] = useState<MunshiRule[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [s, l, r] = await Promise.all([
        memoryListDaySummaries(),
        memoryListLearnings(false),
        memoryListRules(false),
      ]);
      setSummaries(s);
      setLearnings(l);
      setRules(r);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    void refreshMemoryStatus();
  }, [reload, memoryJob.phase]);

  async function forgetLearning(id: string) {
    await memorySetLearningActive(id, false);
    await reload();
  }

  async function forgetRule(id: string) {
    await memorySetRuleActive(id, false);
    await reload();
  }

  async function forgetDay(date: string) {
    await memoryDeleteDaySummary(date);
    await reload();
  }

  const busy = memoryJob.phase === "extracting" || memoryJob.phase === "consolidating";

  return (
    <section className="mistral-settings-section munshi-memory-panel">
      <h3>Munshi memory</h3>
      <p className="text-muted mistral-settings-note">
        Conversations on this device are summarized in the background. Rules and learnings are injected into future
        chats. Portfolio tool data always takes precedence over memory.
      </p>

      <div className="munshi-memory-status panel-card">
        <dl className="munshi-memory-status-grid">
          <div>
            <dt>Queued</dt>
            <dd>{memoryJob.pendingSessions} conversation(s)</dd>
          </div>
          <div>
            <dt>Last processed</dt>
            <dd>
              {memoryJob.lastExtractAt
                ? new Date(memoryJob.lastExtractAt).toLocaleString("en-IN")
                : "Never"}
            </dd>
          </div>
          <div>
            <dt>Auto run today</dt>
            <dd>{memoryJob.lastAutomaticExtractDay === localDayKey() ? "Yes" : "No"}</dd>
          </div>
        </dl>
        <p className="munshi-memory-status-msg">{memoryJob.statusMessage}</p>
        <p className="text-muted munshi-memory-policy-note">
          Automatic processing runs at most once per day (first app open with queued chats). Refreshing the page does
          not re-run if today&apos;s batch already completed. Use “Process now” anytime.
        </p>
      </div>

      <div className="munshi-memory-actions">
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void onRunMemoryNow()}
          disabled={!hasApiKey || busy}
        >
          {busy ? "Processing memory…" : "Process conversations now"}
        </button>
        {memoryJob.phase === "extracting" && memoryJob.totalSessions > 0 ? (
          <span className="munshi-memory-progress">
            {memoryJob.processedSessions}/{memoryJob.totalSessions} sessions
          </span>
        ) : null}
        {memoryJob.phase === "consolidating" ? (
          <span className="munshi-memory-progress">Consolidating learnings…</span>
        ) : null}
        {memoryJob.phase === "error" && memoryJob.error ? (
          <p className="portfolio-chat-error">{memoryJob.error}</p>
        ) : null}
      </div>

      {loading ? <p className="text-muted">Loading memory…</p> : null}

      <div className="munshi-memory-block">
        <h4>Rules ({rules.filter((r) => r.active).length} active)</h4>
        {rules.filter((r) => r.active).length === 0 ? (
          <p className="text-muted munshi-memory-empty">No rules yet.</p>
        ) : (
          <ul className="munshi-memory-list">
            {rules
              .filter((r) => r.active)
              .map((r) => (
                <li key={r.id} className="munshi-memory-item">
                  <span className={`munshi-memory-priority munshi-memory-priority-${r.priority}`}>{r.priority}</span>
                  <span className="munshi-memory-text">{r.text}</span>
                  <button type="button" className="munshi-memory-forget" onClick={() => void forgetRule(r.id)}>
                    Forget
                  </button>
                </li>
              ))}
          </ul>
        )}
      </div>

      <div className="munshi-memory-block">
        <h4>Learnings ({learnings.filter((l) => l.active).length} active)</h4>
        {learnings.filter((l) => l.active).length === 0 ? (
          <p className="text-muted munshi-memory-empty">No learnings yet.</p>
        ) : (
          <ul className="munshi-memory-list">
            {learnings
              .filter((l) => l.active)
              .map((l) => (
                <li key={l.id} className="munshi-memory-item">
                  <span className="munshi-memory-text">{l.text}</span>
                  <button type="button" className="munshi-memory-forget" onClick={() => void forgetLearning(l.id)}>
                    Forget
                  </button>
                </li>
              ))}
          </ul>
        )}
      </div>

      <div className="munshi-memory-block">
        <h4>Day summaries ({summaries.length})</h4>
        {summaries.length === 0 ? (
          <p className="text-muted munshi-memory-empty">No daily summaries yet.</p>
        ) : (
          <ul className="munshi-memory-day-list">
            {summaries.map((d) => (
              <li key={d.date} className="munshi-memory-day">
                <div className="munshi-memory-day-head">
                  <strong>{d.date}</strong>
                  <button type="button" className="munshi-memory-forget" onClick={() => void forgetDay(d.date)}>
                    Forget
                  </button>
                </div>
                <p className="munshi-memory-day-text">{d.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
