/** Strip suffix and map to a consistent short label for screener / UI. */
const AMC_DISPLAY: Record<string, string> = {
  "360 ONE": "360 ONE",
  Abakkus: "Abakkus",
  "Aditya Birla Sun Life": "Aditya Birla Sun Life",
  Axis: "Axis",
  "Bajaj Finserv": "Bajaj Finserv",
  Bandhan: "Bandhan",
  "Bank of India": "Bank of India",
  "Baroda BNP Paribas": "Baroda BNP Paribas",
  "Canara Robeco": "Canara Robeco",
  Capitalmind: "Capitalmind",
  DSP: "DSP",
  Edelweiss: "Edelweiss",
  "Franklin Templeton": "Franklin Templeton",
  Groww: "Groww",
  HDFC: "HDFC",
  HSBC: "HSBC",
  Helios: "Helios",
  "ICICI Prudential": "ICICI Prudential",
  ITI: "ITI",
  Invesco: "Invesco",
  "JM Financial": "JM Financial",
  "Jio BlackRock": "Jio BlackRock",
  Kotak: "Kotak",
  LIC: "LIC",
  "Mahindra Manulife": "Mahindra Manulife",
  "Mirae Asset": "Mirae Asset",
  "Motilal Oswal": "Motilal Oswal",
  NJ: "NJ",
  Navi: "Navi",
  "Nippon India": "Nippon India",
  "Old Bridge": "Old Bridge",
  "PGIM India": "PGIM India",
  PPFAS: "PPFAS",
  Quantum: "Quantum",
  SBI: "SBI",
  Samco: "Samco",
  Shriram: "Shriram",
  Sundaram: "Sundaram",
  Tata: "Tata",
  Taurus: "Taurus",
  "The Wealth Company": "The Wealth Company",
  Trust: "Trust",
  UTI: "UTI",
  Unifi: "Unifi",
  Union: "Union",
  "WhiteOak Capital": "WhiteOak Capital",
  Quant: "Quant",
};

function stripMutualFundSuffix(amc: string): string {
  return amc
    .trim()
    .replace(/\s+Mutual\s+Fund$/i, "")
    .replace(/\s+MF$/i, "")
    .replace(/\s+/g, " ");
}

function titleCaseWord(word: string): string {
  if (!word) return word;
  if (/^\d/.test(word)) return word;
  if (word === word.toUpperCase() && word.length <= 4) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function normalizeBaseName(amc: string): string {
  const stripped = stripMutualFundSuffix(amc);
  if (!stripped) return "—";

  const lower = stripped.toLowerCase();
  if (lower === "quant") return "Quant";

  if (stripped === stripped.toLowerCase() || stripped === stripped.toUpperCase()) {
    return stripped
      .split(" ")
      .map(titleCaseWord)
      .join(" ");
  }

  return stripped;
}

/** Standardized AMC label for tables and filters. */
export function standardizeAmcName(amc: string | null | undefined): string {
  if (!amc?.trim()) return "—";
  const base = normalizeBaseName(amc);
  const short =
    base === "Kotak Mahindra" ? "Kotak" : AMC_DISPLAY[base] ?? base;
  return short;
}
