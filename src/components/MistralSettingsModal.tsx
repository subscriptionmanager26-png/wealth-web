import { useEffect, useState } from "react";

import { maskMistralApiKey } from "../lib/mistralApiKey";
import type { MemoryJobProgress } from "../lib/munshiMemoryScheduler";
import { MunshiMemoryPanel } from "./MunshiMemoryPanel";

type Props = {
  open: boolean;
  onClose: () => void;
  savedKey: string;
  onSaveKey: (key: string) => boolean | Promise<boolean>;
  onClearKey: () => boolean | Promise<boolean>;
  memoryJob: MemoryJobProgress;
  onRunMemoryNow: () => void | Promise<void>;
};

export function MistralSettingsModal({
  open,
  onClose,
  savedKey,
  onSaveKey,
  onClearKey,
  memoryJob,
  onRunMemoryNow,
}: Props) {
  const [keyInput, setKeyInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setKeyInput("");
    setError(null);
  }, [open]);

  if (!open) return null;

  async function saveKey() {
    const next = keyInput.trim();
    if (!next) {
      setError("Enter a valid Mistral API key.");
      return;
    }
    if (!(await onSaveKey(next))) {
      setError("Could not save key. Try freeing browser storage.");
      return;
    }
    setKeyInput("");
    setError(null);
    onClose();
  }

  async function removeKey() {
    if (!(await onClearKey())) {
      setError("Could not remove key.");
      return;
    }
    setKeyInput("");
    setError(null);
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card mistral-settings-modal"
        role="dialog"
        aria-labelledby="mistral-settings-title"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id="mistral-settings-title">AI settings</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <section className="mistral-settings-section">
          <h3>Mistral API key</h3>
          <p className="text-muted mistral-settings-note">
            Your key is stored only in this browser. It is sent to the server when you chat or process memory — never
            saved on our servers.
          </p>

          {savedKey ? (
            <p className="mistral-settings-saved">
              <span className="portfolio-chat-key-badge">Saved</span>
              {maskMistralApiKey(savedKey)}
            </p>
          ) : (
            <p className="mistral-settings-saved mistral-settings-missing">No API key saved yet.</p>
          )}

          <div className="mistral-settings-form">
            <input
              className="portfolio-chat-input"
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder={savedKey ? "Paste a new key to replace" : "Paste your Mistral API key"}
              autoComplete="off"
              spellCheck={false}
            />
            <div className="mistral-settings-actions">
              <button type="button" className="btn-primary" onClick={saveKey} disabled={!keyInput.trim()}>
                {savedKey ? "Update key" : "Save key"}
              </button>
              {savedKey ? (
                <button type="button" className="btn-secondary" onClick={removeKey}>
                  Remove key
                </button>
              ) : null}
            </div>
          </div>
          {error ? <p className="portfolio-chat-error">{error}</p> : null}
        </section>

        <MunshiMemoryPanel memoryJob={memoryJob} onRunMemoryNow={onRunMemoryNow} hasApiKey={Boolean(savedKey)} />

        <section className="mistral-settings-section mistral-settings-help">
          <h3>How to get a Mistral API key</h3>
          <ol>
            <li>
              Open the{" "}
              <a href="https://console.mistral.ai/" target="_blank" rel="noopener noreferrer">
                Mistral AI Console
              </a>
              .
            </li>
            <li>Sign up or log in to your Mistral account.</li>
            <li>
              Go to <strong>API keys</strong> in the left sidebar (or Workspace → API keys).
            </li>
            <li>Click <strong>Create new key</strong>, give it a name, and copy the key.</li>
            <li>Paste the key above and tap <strong>Save key</strong>.</li>
          </ol>
          <p className="text-muted">
            Mistral bills API usage to your account. Keep the key private — anyone with it can use your quota.
          </p>
        </section>
      </div>
    </div>
  );
}
