import { useEffect, useState } from "react";

import type { AgentPlan, ClarificationAnswers } from "../lib/agentPlanning";

type ClarificationModalProps = {
  open: boolean;
  request: { plan: AgentPlan; userQuestion: string } | null;
  onSubmit: (answers: ClarificationAnswers) => void;
  onCancel: () => void;
};

function buildInitialAnswers(plan: AgentPlan): ClarificationAnswers {
  const answers: ClarificationAnswers = {};
  for (const q of plan.questions) {
    if (q.options[0]) {
      answers[q.id] = { optionId: q.options[0].id };
    }
  }
  return answers;
}

function QuestionPage({
  q,
  answer,
  onPickOption,
  onCustomText,
}: {
  q: AgentPlan["questions"][number];
  answer: ClarificationAnswers[string] | undefined;
  onPickOption: (optionId: string) => void;
  onCustomText: (text: string) => void;
}) {
  const selectedOption = answer?.optionId;
  const customText = answer?.customText ?? "";

  return (
    <fieldset className="clarification-question">
      <legend className="clarification-question-text">{q.question}</legend>
      <div className="clarification-options">
        {q.options.map((opt, idx) => {
          const checked = selectedOption === opt.id && !customText.trim();
          return (
            <button
              key={opt.id}
              type="button"
              className={`clarification-option${checked ? " clarification-option-selected" : ""}`}
              onClick={() => onPickOption(opt.id)}
            >
              <span className="clarification-option-rank">{idx + 1}</span>
              <span className="clarification-option-label">{opt.label}</span>
            </button>
          );
        })}
      </div>
      <label className="clarification-custom">
        <span className="clarification-custom-label">Or type your own</span>
        <input
          type="text"
          className="clarification-custom-input"
          placeholder={
            q.customArgHint?.type === "frames"
              ? "e.g. 5Y, YTD, 3M"
              : q.customArgHint?.type === "benchmark_id"
                ? "e.g. Nifty 500"
                : "Your preference"
          }
          value={customText}
          onChange={(e) => onCustomText(e.target.value)}
        />
      </label>
    </fieldset>
  );
}

export function ClarificationModal({ open, request, onSubmit, onCancel }: ClarificationModalProps) {
  const [answers, setAnswers] = useState<ClarificationAnswers>({});
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (open && request) {
      setAnswers(buildInitialAnswers(request.plan));
      setPage(0);
    }
  }, [open, request]);

  if (!open || !request) return null;

  const { plan } = request;
  const questions = plan.questions;
  const pageCount = questions.length;
  const current = questions[page];
  const isFirst = page === 0;
  const isLast = page === pageCount - 1;

  function pickOption(questionId: string, optionId: string) {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: { optionId, customText: "" },
    }));
  }

  function setCustomText(questionId: string, customText: string) {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: { customText, optionId: undefined },
    }));
  }

  function handleSubmit() {
    onSubmit(answers);
  }

  return (
    <div className="clarification-backdrop" role="presentation" onClick={onCancel}>
      <section
        className="clarification-sheet"
        role="dialog"
        aria-labelledby="clarification-title"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="clarification-handle" aria-hidden />

        <header className="clarification-head">
          <div className="clarification-head-main">
            <h2 id="clarification-title">Quick clarifications</h2>
            <p className="muted clarification-subtitle">
              Munshi planned {plan.tools.length} data fetch{plan.tools.length === 1 ? "" : "es"}. A few quick
              choices — one at a time.
            </p>
            {plan.planSummary ? <p className="clarification-plan-summary">{plan.planSummary}</p> : null}
          </div>
          <div className="clarification-head-actions">
            {pageCount > 1 ? (
              <span className="clarification-page-count">
                {page + 1}/{pageCount}
              </span>
            ) : null}
            <button type="button" className="modal-close" onClick={onCancel} aria-label="Close">
              ×
            </button>
          </div>
        </header>

        <div className="clarification-body">
          {current ? (
            <QuestionPage
              q={current}
              answer={answers[current.id]}
              onPickOption={(optionId) => pickOption(current.id, optionId)}
              onCustomText={(text) => setCustomText(current.id, text)}
            />
          ) : null}
        </div>

        <div className="clarification-actions">
          {pageCount === 1 ? (
            <>
              <button type="button" className="btn-secondary" onClick={onCancel}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={handleSubmit}>
                Run {plan.tools.length} tool{plan.tools.length === 1 ? "" : "s"}
              </button>
            </>
          ) : isFirst ? (
            <button type="button" className="btn-primary clarification-action-full" onClick={() => setPage(1)}>
              Next
            </button>
          ) : isLast ? (
            <>
              <button type="button" className="btn-secondary" onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <button type="button" className="btn-primary" onClick={handleSubmit}>
                Run {plan.tools.length} tool{plan.tools.length === 1 ? "" : "s"}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn-secondary" onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <button type="button" className="btn-primary" onClick={() => setPage(page + 1)}>
                Next
              </button>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
