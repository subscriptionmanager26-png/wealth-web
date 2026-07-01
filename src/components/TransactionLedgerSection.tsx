import { useMemo, useState } from "react";

import type { ParsedCas } from "@mobile/utils/casParser";
import {
  buildFundLedger,
  buildMonthlyLedger,
  collectFundUnitsFromDocs,
  collectLedgerTxnsFromDocs,
  type FundLedger,
  type MonthlyLedger,
} from "@mobile/utils/casTransactionLedger";
import { formatInrFull, formatInrShort, formatUnits, hasMaterialHoldingValue } from "../lib/format";

type HoldingInput = {
  id: string;
  name: string;
  value: number;
  totalUnits: number;
};

type TransactionLedgerSectionProps = {
  savedParsedDocs: ParsedCas[];
  holdings: HoldingInput[];
};

function FundLedgerCard({
  fund,
  onPress,
}: {
  fund: FundLedger;
  onPress: () => void;
}) {
  return (
    <button type="button" className="ledger-card" onClick={onPress}>
      <div className="ledger-head">
        <strong className="ledger-title">{fund.fund}</strong>
      </div>
      <div className="ledger-split">
        <div>
          <span className="ledger-split-label">Current value</span>
          <span>{fund.currentValue > 0 ? formatInrShort(fund.currentValue) : "—"}</span>
        </div>
        <div style={{ textAlign: "right" }}>
          <span className="ledger-split-label">Total units</span>
          <span>{fund.totalUnits > 0 ? formatUnits(fund.totalUnits) : "—"}</span>
        </div>
      </div>
    </button>
  );
}

export function TransactionLedgerSection({ savedParsedDocs, holdings }: TransactionLedgerSectionProps) {
  const [txnView, setTxnView] = useState<"month" | "fund">("month");
  const [selectedMonth, setSelectedMonth] = useState<MonthlyLedger | null>(null);
  const [selectedFund, setSelectedFund] = useState<FundLedger | null>(null);

  const monthlyLedger = useMemo(
    () => buildMonthlyLedger(collectLedgerTxnsFromDocs(savedParsedDocs)),
    [savedParsedDocs],
  );

  const fundMetaByName = useMemo(() => {
    const unitsFromCas = collectFundUnitsFromDocs(savedParsedDocs);
    const map = new Map<string, { totalUnits: number; currentValue: number }>();
    const upsert = (key: string, totalUnits: number, valueDelta: number) => {
      const prev = map.get(key) ?? { totalUnits: 0, currentValue: 0 };
      map.set(key, {
        totalUnits: Math.max(prev.totalUnits, totalUnits),
        currentValue: prev.currentValue + valueDelta,
      });
    };
    for (const h of holdings) {
      if (!hasMaterialHoldingValue(h.value)) continue;
      upsert(h.name, h.totalUnits, h.value);
    }
    for (const [fundKey, units] of unitsFromCas.entries()) {
      const prev = map.get(fundKey);
      if (prev) map.set(fundKey, { ...prev, totalUnits: Math.max(prev.totalUnits, units) });
      else upsert(fundKey, units, 0);
    }
    return map;
  }, [holdings, savedParsedDocs]);

  const fundLedger = useMemo(
    () => buildFundLedger(collectLedgerTxnsFromDocs(savedParsedDocs), fundMetaByName),
    [savedParsedDocs, fundMetaByName],
  );

  const activeFundLedger = fundLedger.filter((f) => hasMaterialHoldingValue(f.currentValue));

  return (
    <div>
      {!selectedMonth && !selectedFund ? (
        <div className="segmented-nav">
          <button
            type="button"
            className={`segmented-btn ${txnView === "month" ? "segmented-btn-active" : ""}`}
            onClick={() => setTxnView("month")}
          >
            Month wise
          </button>
          <button
            type="button"
            className={`segmented-btn ${txnView === "fund" ? "segmented-btn-active" : ""}`}
            onClick={() => setTxnView("fund")}
          >
            Fund wise
          </button>
        </div>
      ) : null}

      {txnView === "month" && !selectedMonth ? (
        !monthlyLedger.length ? (
          <p className="muted">Upload a CAS to see month-wise transactions.</p>
        ) : (
          monthlyLedger.map((m) => (
            <button key={m.monthKey} type="button" className="ledger-card" onClick={() => setSelectedMonth(m)}>
              <div className="ledger-head">
                <strong className="ledger-title">{m.month}</strong>
                <span className="ledger-badge">{m.txns.length} txns</span>
              </div>
              <div className="ledger-split">
                <div>
                  <span className="ledger-split-label">Invested</span>
                  <span className="positive">+{formatInrFull(m.totalInvested)}</span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span className="ledger-split-label">Redeemed</span>
                  <span className="negative">{m.totalRedeemed > 0 ? `-${formatInrFull(m.totalRedeemed)}` : "₹0"}</span>
                </div>
              </div>
            </button>
          ))
        )
      ) : null}

      {txnView === "month" && selectedMonth ? (
        <div>
          <button type="button" className="back-card" onClick={() => setSelectedMonth(null)}>
            <span className="back-card-icon">‹</span>
            <div>
              <strong>{selectedMonth.month}</strong>
              <p className="muted">Back to all months</p>
            </div>
          </button>
          <div className="txn-panel">
            {selectedMonth.txns.map((txn) => (
              <div key={txn.id} className="txn-row">
                <div>
                  <strong>{txn.fund}</strong>
                  <p className="muted">
                    {txn.date} · {txn.category}
                  </p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span className={txn.type === "Investment" ? "positive" : "negative"}>
                    {txn.type === "Redemption" ? "-" : "+"}
                    {formatInrFull(txn.amount)}
                  </span>
                  {txn.units !== "—" ? <p className="muted">{txn.units} units</p> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {txnView === "fund" && !selectedFund ? (
        !fundLedger.length ? (
          <p className="muted">No fund-wise transactions in your CAS library.</p>
        ) : (
          <>
            {activeFundLedger.length ? (
              activeFundLedger.map((f) => (
                <FundLedgerCard key={f.fundKey} fund={f} onPress={() => setSelectedFund(f)} />
              ))
            ) : (
              <p className="muted">No active funds with balance ≥ ₹1.</p>
            )}
          </>
        )
      ) : null}

      {txnView === "fund" && selectedFund ? (
        <div>
          <button type="button" className="back-card" onClick={() => setSelectedFund(null)}>
            <span className="back-card-icon">‹</span>
            <div>
              <strong>{selectedFund.fund}</strong>
              <p className="muted">Back to all funds</p>
            </div>
          </button>
          <div className="txn-panel">
            {selectedFund.txns.map((txn) => (
              <div key={txn.id} className="txn-row">
                <div>
                  <strong>{txn.category}</strong>
                  <p className="muted">{txn.date}</p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span className={txn.type === "Investment" ? "positive" : "negative"}>
                    {txn.type === "Redemption" ? "-" : "+"}
                    {formatInrFull(txn.amount)}
                  </span>
                  {txn.units !== "—" ? <p className="muted">{txn.units} units</p> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
