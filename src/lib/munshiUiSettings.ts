import { safeLocalStorageSet } from "./safeLocalStorage";

/** How Munshi Ji renders assistant answers. Default is classic markdown. */
export type MunshiAnswerUi = "markdown" | "generative";

const STORAGE_KEY = "wealth_web_munshi_answer_ui_v1";

export const DEFAULT_MUNSHI_ANSWER_UI: MunshiAnswerUi = "markdown";

export function loadMunshiAnswerUi(): MunshiAnswerUi {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "generative") return "generative";
    return DEFAULT_MUNSHI_ANSWER_UI;
  } catch {
    return DEFAULT_MUNSHI_ANSWER_UI;
  }
}

export function saveMunshiAnswerUi(ui: MunshiAnswerUi): boolean {
  return safeLocalStorageSet(STORAGE_KEY, ui);
}

export function isGenerativeUiEnabled(ui: MunshiAnswerUi = loadMunshiAnswerUi()): boolean {
  return ui === "generative";
}
