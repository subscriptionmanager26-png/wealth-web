/** Shared types for MF Central, CDSL demat, and NPS statement parsers. */

export type StatementKind = "cams_kfin_cas" | "mf_central" | "cdsl_cas" | "nps" | "unknown";

export type StatementTransaction = {
  date: string;
  description: string;
  amount_inr: string | null;
  units: string | null;
  price_inr: string | null;
  nav_inr: string | null;
  unit_balance: string | null;
};

export type MfHoldingRow = {
  amc: string | null;
  folio_no: string | null;
  isin: string | null;
  scheme_code: string | null;
  scheme_name: string | null;
  closing_units: string | null;
  nav_inr: string | null;
  cost_value_inr: string | null;
  market_value_inr: string | null;
  gain_pct: string | null;
  plan_tag: string | null;
  transactions: StatementTransaction[];
};

export type DematHoldingRow = {
  isin: string;
  security_name: string;
  current_balance: string;
  free_balance: string | null;
  pledge_balance: string | null;
  frozen_balance: string | null;
  market_price_inr: string | null;
  market_value_inr: string | null;
  dp_id: string | null;
  client_id: string | null;
  bo_id: string | null;
  dp_name: string | null;
  /** ELSS / lock-in lots in CDSL "Other Details" — no market price in statement */
  is_locked?: boolean;
  lockin_release_date?: string | null;
};

export type DematTransactionRow = {
  date: string;
  isin: string;
  security_name: string;
  description: string;
  opening_balance: string | null;
  credit: string | null;
  debit: string | null;
  closing_balance: string | null;
  stamp_duty_inr: string | null;
  dp_id: string | null;
  client_id: string | null;
  bo_id: string | null;
};

export type NpsHoldingRow = {
  pran: string | null;
  tier: "T1" | "T2" | "unknown";
  scheme_name: string | null;
  /** Pension Fund Manager / AMC (e.g. HDFC Pension Fund Management Limited) */
  amc_name: string | null;
  /** NPS asset class code: E / C / G / A */
  scheme_code: string | null;
  allocation_pct: string | null;
  pension_fund: string | null;
  invested_amount_inr: string | null;
  units: string | null;
  nav_inr: string | null;
  market_value_inr: string | null;
  contribution_inr: string | null;
  unrealised_gain_inr: string | null;
};

export type NpsTierSummary = {
  tier: "T1" | "T2";
  status: string | null;
  total_contribution_inr: string | null;
  contribution_count: string | null;
  withdrawal_billing_deductions_inr: string | null;
  current_invested_amount_inr: string | null;
  current_valuation_inr: string | null;
  xirr_since_inception_pct: string | null;
};

export type NpsNominee = {
  name: string;
  relationship: string | null;
  tier1_pct: string | null;
  tier2_pct: string | null;
};

export type ParsedMfCentralStatement = {
  kind: "mf_central";
  source_file: string;
  period_from: string | null;
  period_to: string | null;
  investor_name: string | null;
  investor_pan: string | null;
  address: string | null;
  total_portfolio_value_inr: string | null;
  total_invested_value_inr: string | null;
  total_gain_inr: string | null;
  absolute_gain_pct: string | null;
  holdings: MfHoldingRow[];
};

export type ParsedCdslStatement = {
  kind: "cdsl_cas";
  source_file: string;
  cas_id: string | null;
  period_from: string | null;
  period_to: string | null;
  investor_name: string | null;
  investor_pan: string | null;
  address: string | null;
  total_portfolio_value_inr: string | null;
  demat_value_inr: string | null;
  mf_folios_value_inr: string | null;
  nps_value_inr: string | null;
  demat_accounts: {
    dp_name: string | null;
    dp_id: string | null;
    client_id: string | null;
    bo_id: string | null;
    value_inr: string | null;
  }[];
  demat_holdings: DematHoldingRow[];
  /** Lock-in / pending demat-remat lots (no price in CDSL summary) */
  locked_demat_holdings: DematHoldingRow[];
  demat_transactions: DematTransactionRow[];
  mf_holdings: MfHoldingRow[];
  nps_holdings: NpsHoldingRow[];
};

export type ParsedNpsStatement = {
  kind: "nps";
  source_file: string;
  period_from: string | null;
  period_to: string | null;
  statement_date: string | null;
  investor_name: string | null;
  investor_pan: string | null;
  pran: string | null;
  pran_generated_date: string | null;
  address: string | null;
  mobile: string | null;
  email: string | null;
  pop_name: string | null;
  pop_registration_no: string | null;
  total_value_inr: string | null;
  tiers: NpsTierSummary[];
  holdings: NpsHoldingRow[];
  nominees: NpsNominee[];
};

export type ParsedStatement =
  | ParsedMfCentralStatement
  | ParsedCdslStatement
  | ParsedNpsStatement
  | { kind: "unknown"; source_file: string; reason: string };
