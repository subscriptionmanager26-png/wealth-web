import { useEffect, useRef, useState } from "react";

import { activitySummary, type AgentStep } from "../lib/agentSteps";

type Props = {
  steps: AgentStep[];
  active: boolean;
  hasAnswer: boolean;
};

const REVEAL_DONE_MS = 80;
const REVEAL_RUNNING_MS = 24;

function StepIcon({ step }: { step: AgentStep }) {
  if (step.status === "running") {
    return <span className="chat-agent-step-dot chat-agent-step-dot-running" aria-hidden />;
  }
  if (step.status === "error") {
    return <span className="chat-agent-step-dot chat-agent-step-dot-error" aria-hidden>×</span>;
  }
  return <span className="chat-agent-step-dot chat-agent-step-dot-done" aria-hidden>✓</span>;
}

function stepDurationLabel(step: AgentStep): string | null {
  if (!step.startedAt || !step.endedAt || step.status !== "done") return null;
  const totalMs = step.endedAt - step.startedAt;
  if (totalMs < 100) return null;
  return `${(totalMs / 1000).toFixed(1)}s`;
}

function StepRow({ step, isLast }: { step: AgentStep; isLast: boolean }) {
  const isRunning = step.status === "running";
  const [reasonOpen, setReasonOpen] = useState(false);
  const duration = stepDurationLabel(step);

  const showDetail =
    step.detail &&
    (step.kind === "tool" || step.label === "Reasoning" || step.kind === "think" || (isRunning && step.kind === "think"));

  return (
    <li
      className={`chat-agent-step chat-agent-step-${step.kind} chat-agent-step-${step.status}${isRunning ? " chat-agent-step-current" : ""}${!isLast ? " chat-agent-step-has-next" : ""} chat-agent-step-enter`}
    >
      <div className="chat-agent-step-rail">
        <StepIcon step={step} />
      </div>
      <div className="chat-agent-step-content">
        {step.kind === "tool" ? (
          <div className="chat-agent-tool-head">
            <span className="chat-agent-tool-badge">Tool</span>
            <code className="chat-agent-tool-name">{step.label}</code>
          </div>
        ) : (
          <span className="chat-agent-step-label">
            {step.label}
            {duration ? <span className="chat-agent-step-duration"> {duration}</span> : null}
          </span>
        )}
        {step.label === "Reasoning" && step.detail ? (
          <button
            type="button"
            className="chat-agent-reason-toggle"
            onClick={() => setReasonOpen((v) => !v)}
            aria-expanded={reasonOpen}
          >
            {reasonOpen ? "Hide reasoning" : "Show reasoning"}
          </button>
        ) : null}
        {showDetail && (step.label !== "Reasoning" || reasonOpen) ? (
          <p className="chat-agent-step-detail">{step.detail}</p>
        ) : null}
      </div>
    </li>
  );
}

export function ChatAgentSteps({ steps, active, hasAnswer }: Props) {
  const [open, setOpen] = useState(true);
  const [revealedCount, setRevealedCount] = useState(0);
  const revealTimer = useRef<number | null>(null);

  const running = steps.some((s) => s.status === "running");
  const visibleSteps = steps.slice(0, revealedCount);
  const summary = activitySummary(steps);

  useEffect(() => {
    if (!steps.length) {
      setRevealedCount(0);
      return;
    }
    if (revealedCount === 0) {
      setRevealedCount(1);
      return;
    }
    if (revealedCount >= steps.length) return;

    const prev = steps[revealedCount - 1];
    const delay = prev?.status === "running" ? REVEAL_RUNNING_MS : REVEAL_DONE_MS;
    revealTimer.current = window.setTimeout(() => {
      setRevealedCount((c) => Math.min(c + 1, steps.length));
    }, delay);

    return () => {
      if (revealTimer.current) window.clearTimeout(revealTimer.current);
    };
  }, [steps, revealedCount]);

  useEffect(() => {
    if (hasAnswer && !running) setOpen(false);
  }, [hasAnswer, running]);

  if (!steps.length) return null;

  const expanded = open || running || active;
  const headerLabel = running ? activitySummary(visibleSteps.length ? visibleSteps : steps) : summary;

  return (
    <div
      className={`chat-agent-trace${running ? " chat-agent-trace-live" : ""}${hasAnswer ? " chat-agent-trace-complete" : ""}`}
    >
      <button
        type="button"
        className="chat-agent-trace-header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="chat-agent-trace-chevron" aria-hidden>
          {expanded ? "▾" : "▸"}
        </span>
        <span className="chat-agent-trace-title">{headerLabel}</span>
        {running ? <span className="chat-agent-trace-pulse" aria-hidden /> : null}
      </button>

      {expanded ? (
        <ol className="chat-agent-trace-list">
          {visibleSteps.map((step, i) => (
            <StepRow
              key={step.id}
              step={step}
              isLast={revealedCount >= steps.length && i === visibleSteps.length - 1}
            />
          ))}
        </ol>
      ) : null}
    </div>
  );
}
