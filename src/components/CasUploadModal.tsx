import { useRef, useState } from "react";

type CasUploadModalProps = {
  open: boolean;
  busy: boolean;
  status: string;
  onClose: () => void;
  onUpload: (file: File, password?: string) => Promise<void>;
};

export function CasUploadModal({ open, busy, status, onClose, onUpload }: CasUploadModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [password, setPassword] = useState("");
  const [dragOver, setDragOver] = useState(false);

  if (!open) return null;

  const handleFile = async (file: File | undefined) => {
    if (!file || busy) return;
    await onUpload(file, password.trim() || undefined);
    setPassword("");
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal-card upload-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Upload CAS PDF</h3>
        <p className="muted">Password-protected statements are supported.</p>

        <label className="field-label" htmlFor="cas-password">
          PDF password (optional)
        </label>
        <input
          id="cas-password"
          type="password"
          className="text-input"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
          placeholder="Leave blank if not protected"
        />

        <div
          className={`drop-zone ${dragOver ? "drop-zone-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void handleFile(e.dataTransfer.files?.[0]);
          }}
          onClick={() => inputRef.current?.click()}
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
          <p>{busy ? status || "Saving…" : "Drop PDF here or click to browse"}</p>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
