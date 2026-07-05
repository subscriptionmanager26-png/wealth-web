import { useEffect, useMemo, useRef, useState } from "react";

import { formatDateDisplay, type ToolApprovalField } from "../lib/toolInputApproval";

const FIELDS_PER_PAGE = 4;

type ToolInputApprovalModalProps = {
  open: boolean;
  toolName: string;
  toolDescription: string;
  fields: ToolApprovalField[];
  onApprove: (fields: ToolApprovalField[]) => void;
  onCancel: () => void;
  onFieldsChange?: (fields: ToolApprovalField[]) => ToolApprovalField[];
};

function chunkFields(fields: ToolApprovalField[]): ToolApprovalField[][] {
  const pages: ToolApprovalField[][] = [];
  for (let i = 0; i < fields.length; i += FIELDS_PER_PAGE) {
    pages.push(fields.slice(i, i + FIELDS_PER_PAGE));
  }
  return pages.length ? pages : [[]];
}

function DateFieldEditor({
  field,
  onChange,
}: {
  field: ToolApprovalField;
  onChange: (next: ToolApprovalField) => void;
}) {
  const pickerRef = useRef<HTMLInputElement>(null);
  const iso = String(field.value ?? "");
  const display = formatDateDisplay(iso);

  return (
    <div className="tool-approval-field">
      <span className="tool-approval-label">
        {field.label}
        {field.derived ? <span className="tool-approval-derived"> · suggested</span> : null}
      </span>
      <div className="tool-approval-date-row">
        <span className="tool-approval-date-display" aria-live="polite">
          {display || "Select a date"}
        </span>
        <button
          type="button"
          className="btn-secondary tool-approval-date-btn"
          onClick={() => {
            const el = pickerRef.current;
            if (!el) return;
            if (typeof el.showPicker === "function") el.showPicker();
            else el.click();
          }}
        >
          Change
        </button>
        <input
          ref={pickerRef}
          type="date"
          className="tool-approval-date-native"
          value={iso}
          tabIndex={-1}
          aria-hidden
          onChange={(e) => onChange({ ...field, value: e.target.value, derived: false })}
        />
      </div>
      {field.hint ? <span className="tool-approval-hint">{field.hint}</span> : null}
    </div>
  );
}

function FieldEditor({
  field,
  onChange,
}: {
  field: ToolApprovalField;
  onChange: (next: ToolApprovalField) => void;
}) {
  const id = `tool-field-${field.key}`;

  if (field.type === "readonly") {
    return (
      <div className="tool-approval-field">
        <span className="tool-approval-label">{field.label}</span>
        <p className="tool-approval-readonly">{String(field.value)}</p>
      </div>
    );
  }

  if (field.type === "boolean") {
    return (
      <label className="tool-approval-field tool-approval-check" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={Boolean(field.value)}
          onChange={(e) => onChange({ ...field, value: e.target.checked })}
        />
        <span>{field.label}</span>
        {field.hint ? <span className="tool-approval-hint">{field.hint}</span> : null}
      </label>
    );
  }

  if (field.type === "select") {
    return (
      <label className="tool-approval-field" htmlFor={id}>
        <span className="tool-approval-label">{field.label}</span>
        <select
          id={id}
          className="tool-approval-input tool-approval-select"
          value={String(field.value ?? "")}
          onChange={(e) => onChange({ ...field, value: e.target.value, derived: false })}
        >
          {(field.options ?? []).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {field.hint ? <span className="tool-approval-hint">{field.hint}</span> : null}
      </label>
    );
  }

  if (field.type === "multiselect") {
    const selected = Array.isArray(field.value) ? field.value.map(String) : [];
    const size = Math.min(6, Math.max(3, (field.options ?? []).length));
    return (
      <label className="tool-approval-field" htmlFor={id}>
        <span className="tool-approval-label">{field.label}</span>
        <select
          id={id}
          multiple
          size={size}
          className="tool-approval-input tool-approval-multiselect-native"
          value={selected}
          onChange={(e) => {
            const next = Array.from(e.target.selectedOptions).map((o) => o.value);
            onChange({ ...field, value: next, derived: false });
          }}
        >
          {(field.options ?? []).map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className="tool-approval-hint">
          {field.hint ?? "Hold Cmd/Ctrl to select multiple options"}
        </span>
      </label>
    );
  }

  if (field.type === "number") {
    return (
      <label className="tool-approval-field" htmlFor={id}>
        <span className="tool-approval-label">{field.label}</span>
        <input
          id={id}
          type="number"
          className="tool-approval-input"
          value={field.value === "" || field.value == null ? "" : Number(field.value)}
          onChange={(e) =>
            onChange({
              ...field,
              value: e.target.value === "" ? "" : Number(e.target.value),
              derived: false,
            })
          }
        />
        {field.hint ? <span className="tool-approval-hint">{field.hint}</span> : null}
      </label>
    );
  }

  if (field.type === "date") {
    return <DateFieldEditor field={field} onChange={onChange} />;
  }

  return (
    <label className="tool-approval-field" htmlFor={id}>
      <span className="tool-approval-label">{field.label}</span>
      <input
        id={id}
        type="text"
        className="tool-approval-input"
        value={String(field.value ?? "")}
        onChange={(e) => onChange({ ...field, value: e.target.value, derived: false })}
      />
      {field.hint ? <span className="tool-approval-hint">{field.hint}</span> : null}
    </label>
  );
}

export function ToolInputApprovalModal({
  open,
  toolName,
  toolDescription,
  fields: initialFields,
  onApprove,
  onCancel,
  onFieldsChange,
}: ToolInputApprovalModalProps) {
  const [fields, setFields] = useState<ToolApprovalField[]>(initialFields);
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (open) {
      setFields(initialFields);
      setPage(0);
    }
  }, [open, initialFields]);

  const pages = useMemo(() => chunkFields(fields), [fields]);
  const pageCount = pages.length;
  const currentFields = pages[page] ?? [];
  const isFirst = page === 0;
  const isLast = page === pageCount - 1;

  function patchField(index: number, next: ToolApprovalField) {
    setFields((prev) => {
      const copy = [...prev];
      copy[index] = next;
      return onFieldsChange ? onFieldsChange(copy) : copy;
    });
  }

  if (!open) return null;

  return (
    <div className="tool-approval-backdrop" role="presentation" onClick={onCancel}>
      <section
        className="tool-approval-sheet"
        role="dialog"
        aria-labelledby="tool-approval-title"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tool-approval-handle" aria-hidden />

        <header className="tool-approval-head">
          <div className="tool-approval-head-main">
            <h2 id="tool-approval-title">Confirm tool inputs</h2>
            <p className="muted tool-approval-subtitle">
              <code>{toolName}</code>
              <span className="tool-approval-subtitle-sep"> — </span>
              <span>{toolDescription}</span>
            </p>
          </div>
          <div className="tool-approval-head-actions">
            {pageCount > 1 ? (
              <span className="tool-approval-page-count">
                {page + 1}/{pageCount}
              </span>
            ) : null}
            <button type="button" className="modal-close" onClick={onCancel} aria-label="Close">
              ×
            </button>
          </div>
        </header>

        <div className="tool-approval-body">
          {currentFields.map((field) => {
            const globalIndex = fields.findIndex((f) => f.key === field.key);
            return (
              <FieldEditor
                key={field.key}
                field={field}
                onChange={(next) => patchField(globalIndex, next)}
              />
            );
          })}
        </div>

        <div className="tool-approval-actions">
          {pageCount === 1 ? (
            <>
              <button type="button" className="btn-secondary" onClick={onCancel}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={() => onApprove(fields)}>
                Approve
              </button>
            </>
          ) : isFirst ? (
            <button type="button" className="btn-primary tool-approval-action-full" onClick={() => setPage(1)}>
              Next
            </button>
          ) : isLast ? (
            <>
              <button type="button" className="btn-secondary" onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <button type="button" className="btn-primary" onClick={() => onApprove(fields)}>
                Approve
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
