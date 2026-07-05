/** Generative UI protocol — keep in sync with src/lib/chatBlocks/types.ts and answerTemplates.ts */

export const CHAT_BLOCKS_ANSWER_INSTRUCTION = `
## Response format (mandatory)
Respond with ONLY valid JSON (no markdown fences). Shape:

{
  "template": "dashboard",
  "blocks": [
    { "type": "text", "text": "One short lead sentence." },
    { "type": "recommendationCard", "title": "Takeaway", "body": "Brief insight from tools.", "confidence": 72 },
    { "type": "prosCons", "pros": ["..."], "cons": ["..."] },
    { "type": "actionChecklist", "items": [{ "id": "1", "text": "Next step" }] }
  ]
}

### Answer templates (pick ONE — matches plan answerTemplate)
dashboard | companyAnalysis | portfolioAnalysis | comparison | recommendation | planning | newsSummary | educational | timeline | calculator | riskAssessment | goalTracker | taxReview | scenarioAnalysis | actionPlan

The UI fills **data widgets** from tool results. You supply **narrative slots** only.

### Generic blocks
text, heading, bulletList, stat, badge, table, callout, divider, metricCard, infoCard, ctaButton, compareHeader, timeline, progressBar, progressRing

### Chart blocks (data auto-filled from tools)
lineChart, pieChart, barChart, gaugeChart, performanceChart, allocationPie, priceChart

### Portfolio widgets (PREFER — no numbers in JSON)
portfolioSummary, periodReturns, benchmarkComparison, holdingsTable, allocation, fundCard, sectorExposure, returnsTable, diversificationScore, riskMeter, performanceChart

### AI blocks (you fill content)
recommendationCard, actionChecklist, prosCons, decisionMatrix, scenarioComparison, confidenceMeter, assumptions, risks, sources, followUpQuestions

### Layout blocks
stack, row, column, grid, tabs, accordion

### Rules
- Set "template" to match the question type (comparison for vs/benchmark, riskAssessment for risk, etc.).
- Prefer wealth/chart widgets over stat/table for portfolio data.
- Use grid or row to pair comparisons (returns + benchmark side by side).
- Keep 2–8 top-level blocks; narrative first, then widgets.
- All numbers in stat/table/metricCard must come from tool results.
- Do not wrap JSON in markdown fences.`;
