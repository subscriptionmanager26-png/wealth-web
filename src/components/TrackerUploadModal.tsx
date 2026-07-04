import { useEffect, useRef, useState } from "react";

import { PdfIncorrectPasswordError, PdfPasswordRequiredError } from "../lib/pdfExtract";

type TrackerUploadModalProps = {
  open: boolean;
  busy: boolean;
  status: string;
  onClose: () => void;
  onProcessFile: (file: File, password?: string) => Promise<void>;
};

type Step = "pick" | "processing" | "password";

export function TrackerUploadModal({ open, busy, status, onClose, onProcessFile }: TrackerUploadModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);
  const [step, setStep] = useState<Step>("pick");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (!open) {
      setStep("pick");
      setPendingFile(null);
      setPassword("");
      setPasswordError(null);
      setDragOver(false);
      cancelledRef.current = false;
    }
  }, [open]);

  if (!open) return null;

  const handleClose = () => {
    cancelledRef.current = true;
    onClose();
  };

  const runProcess = async (file: File, pwd?: string) => {
    setStep("processing");
    setPasswordError(null);
    try {
      await onProcessFile(file, pwd?.trim() || undefined);
      if (cancelledRef.current) return;
      onClose();
    } catch (e) {
      if (cancelledRef.current) return;
      if (e instanceof PdfPasswordRequiredError || e instanceof PdfIncorrectPasswordError) {
        setPendingFile(file);
        setStep("password");
        setPasswordError(e instanceof PdfIncorrectPasswordError ? e.message : null);
        if (e instanceof PdfIncorrectPasswordError) setPassword("");
        return;
      }
      setStep("pick");
      setPendingFile(null);
      setPassword("");
      throw e;
    }
  };

  const handleFile = async (file: File | undefined) => {
    if (!file || busy || step === "processing") return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return;
    cancelledRef.current = false;
    setPendingFile(file);
    setPassword("");
    setPasswordError(null);
    try {
      await runProcess(file);
    } catch {
      /* error toast handled by upload hook */
    }
  };

  const handlePasswordSubmit = async () => {
    if (!pendingFile || busy || !password.trim()) return;
    cancelledRef.current = false;
    try {
      await runProcess(pendingFile, password);
    } catch {
      /* error toast handled by upload hook */
    }
  };

  const processing = step === "processing" || busy;

  return (
    <div className="modal-backdrop" onClick={processing ? undefined : handleClose}>
      <div className="modal-card upload-modal" onClick={(e) => e.stopPropagation()}>
        {step === "password" && pendingFile ? (
          <>
            <h3>PDF password required</h3>
            <p className="muted">
              <strong>{pendingFile.name}</strong> is encrypted. Enter the password to continue (usually your PAN).
            </p>
            {passwordError ? <p className="upload-error-text">{passwordError}</p> : null}
            <label className="field-label" htmlFor="tracker-password">
              PDF password
            </label>
            <input
              id="tracker-password"
              type="password"
              className="text-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={processing}
              placeholder="Enter PDF password"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && password.trim()) void handlePasswordSubmit();
              }}
            />
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={handleClose} disabled={processing}>
                Cancel upload
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void handlePasswordSubmit()}
                disabled={processing || !password.trim()}
              >
                {processing ? status || "Unlocking…" : "Unlock & parse"}
              </button>
            </div>
          </>
        ) : (
          <>
            <h3>Upload statement</h3>
            <p className="muted">Add one PDF — CAMS/KFintech CAS, MF Central, CDSL CAS, or NPS. Files stay on this device.</p>

            <div
              className={`drop-zone ${dragOver ? "drop-zone-over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                if (!processing) setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                void handleFile(e.dataTransfer.files?.[0]);
              }}
              onClick={() => {
                if (!processing) inputRef.current?.click();
              }}
            >
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,.pdf"
                hidden
                onChange={(e) => {
                  void handleFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <p>{processing ? status || "Processing…" : "Drop a PDF here or click to browse"}</p>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={handleClose} disabled={processing}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
