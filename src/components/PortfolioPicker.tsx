import { formatInrShort } from "../lib/format";

export type PortfolioProfileStat = {
  id: string;
  name: string;
  total: number;
  invested: number;
  xirr: string;
};

type PortfolioPickerProps = {
  visible: boolean;
  open: boolean;
  profiles: PortfolioProfileStat[];
  activeProfileId: string;
  onToggle: () => void;
  onSelect: (id: string) => void;
  onClose: () => void;
};

export function PortfolioPicker({
  visible,
  open,
  profiles,
  activeProfileId,
  onToggle,
  onSelect,
  onClose,
}: PortfolioPickerProps) {
  if (!visible) return null;

  return (
    <>
      {open ? <button type="button" className="fab-backdrop" aria-label="Close portfolio picker" onClick={onClose} /> : null}
      {open ? (
        <div className="fab-menu" role="menu">
          <p className="fab-menu-eyebrow">Select portfolio</p>
          {profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              role="menuitem"
              className={`fab-menu-item ${activeProfileId === p.id ? "fab-menu-item-active" : ""}`}
              onClick={() => {
                onSelect(p.id);
                onClose();
              }}
            >
              <span className="fab-menu-name">{p.name}</span>
              <span className="fab-menu-value">{formatInrShort(p.total)}</span>
            </button>
          ))}
        </div>
      ) : null}
      <button
        type="button"
        className={`family-fab ${open ? "family-fab-open" : ""}`}
        aria-label="Switch family member portfolio"
        onClick={onToggle}
      >
        <span className="family-fab-icon">{open ? "👥" : "👤"}</span>
      </button>
    </>
  );
}
