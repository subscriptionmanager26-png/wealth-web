/** Payload posted into `buildCamsCasInjectScript` (embedded as JSON in injected JS). */
export type CamsCasInjectInput = {
  email: string;
  password: string;
  /** ISO strings; formatted to DD-Mon-YYYY in Asia/Kolkata inside the WebView. */
  fromIso: string;
  toIso: string;
  zeroBalFolio: "Y" | "N";
  pan?: string;
  /** UI mode: if false, only prefill and wait for user submit. */
  autoSubmit?: boolean;
};
