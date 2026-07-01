import { useState } from "react";

import type { CasInvestorProfile } from "@mobile/utils/casInvestorProfiles";
import { formatInrShort } from "../lib/format";
import type { PortfolioProfileStat } from "./PortfolioPicker";

type AccountDetailsTabProps = {
  profileStats: PortfolioProfileStat[];
  savedInvestors: CasInvestorProfile[];
  activePortfolioName: string;
  onAddMember: (name: string) => boolean;
};

export function AccountDetailsTab({
  profileStats,
  savedInvestors,
  activePortfolioName,
  onAddMember,
}: AccountDetailsTabProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");

  const primary = savedInvestors[0];
  const initials = (primary?.name ?? activePortfolioName ?? "U")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const submitMember = () => {
    if (onAddMember(newMemberName)) {
      setNewMemberName("");
      setAddOpen(false);
    }
  };

  return (
    <div className="tab-panel account-panel">
      <section className="profile-hero panel-card">
        <div className="profile-avatar-lg">{initials || "U"}</div>
        <h2 className="profile-hero-name">{primary?.name ?? activePortfolioName ?? "Your portfolio"}</h2>
        {primary?.pan ? (
          <p className="muted">PAN {primary.pan} · From CAS</p>
        ) : (
          <p className="muted">Upload a CAS to populate investor details</p>
        )}
      </section>

      <section className="panel-card">
        <h2 className="section-title">👥 Family accounts</h2>
        {profileStats.map((p) => (
          <div key={p.id} className="family-account-row">
            <div>
              <strong>{p.name}</strong>
              <p className="muted">
                {p.id === "family" ? "Entire family" : "Member"} · XIRR {p.xirr}
              </p>
            </div>
            <span className="family-account-badge">{formatInrShort(p.total)}</span>
          </div>
        ))}
        <button type="button" className="btn-secondary" style={{ marginTop: 12 }} onClick={() => setAddOpen(true)}>
          + Add member
        </button>
      </section>

      {savedInvestors.length ? (
        <section className="panel-card">
          <h2 className="section-title">📋 Investor details</h2>
          {savedInvestors.map((inv) => (
            <div key={inv.id} className="investor-block">
              <strong>{inv.name}</strong>
              {inv.pan ? <p className="muted">PAN {inv.pan}</p> : null}
              {inv.email ? <p className="muted">{inv.email}</p> : null}
              {inv.mobile ? <p className="muted">{inv.mobile}</p> : null}
              {inv.address ? <p className="muted">{inv.address}</p> : null}
            </div>
          ))}
        </section>
      ) : null}

      {addOpen ? (
        <div className="modal-backdrop" onClick={() => setAddOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>Add family member</h3>
            <p className="muted">Manual members can be selected in the portfolio picker before they upload their own CAS.</p>
            <label className="field-label" htmlFor="member-name">
              Name
            </label>
            <input
              id="member-name"
              className="text-field"
              value={newMemberName}
              onChange={(e) => setNewMemberName(e.target.value)}
              placeholder="Member name"
            />
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setAddOpen(false)}>
                Cancel
              </button>
              <button type="button" className="btn-primary" onClick={submitMember}>
                Add
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
