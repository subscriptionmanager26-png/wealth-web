/**
 * Fix common LLM formatting glitches before Markdown render.
 * Mistral sometimes emits JSON-style "\\n" (two chars) instead of real newlines.
 */
export function normalizeChatMarkdown(content: string): string {
  if (!content) return content;
  if (!content.includes("\\n") && !content.includes("/n")) return content;
  return content.replace(/\\n/g, "\n").replace(/\/n/g, "\n");
}
