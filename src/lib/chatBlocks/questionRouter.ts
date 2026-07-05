import type { AnswerTemplate } from "./answerTemplates";

type RouteRule = { template: AnswerTemplate; patterns: RegExp[] };

const RULES: RouteRule[] = [
  {
    template: "comparison",
    patterns: [
      /\bvs\.?\b/i,
      /\bversus\b/i,
      /\bcompare\b/i,
      /\boutperform/i,
      /\bbenchmark\b/i,
      /\bbetter than\b/i,
      /\balpha\b/i,
    ],
  },
  {
    template: "riskAssessment",
    patterns: [
      /\brisk\b/i,
      /\bvolatil/i,
      /\bdrawdown\b/i,
      /\bconcentrat/i,
      /\bbeta\b/i,
      /\bstress test\b/i,
      /\bworst case\b/i,
      /\bsharpe\b/i,
    ],
  },
  {
    template: "recommendation",
    patterns: [
      /\bshould i\b/i,
      /\bbuy\b/i,
      /\bsell\b/i,
      /\brecommend/i,
      /\badvice\b/i,
      /\bwhat to do\b/i,
      /\bimprove\b/i,
      /\brebalanc/i,
    ],
  },
  {
    template: "actionPlan",
    patterns: [/\bnext step/i, /\baction plan\b/i, /\bwhat am i missing\b/i, /\btodo\b/i, /\bchecklist\b/i],
  },
  {
    template: "planning",
    patterns: [
      /\bretire/i,
      /\bfire\b/i,
      /\bprojection\b/i,
      /\bfuture corpus\b/i,
      /\bwithdrawal\b/i,
      /\bsip required\b/i,
    ],
  },
  {
    template: "goalTracker",
    patterns: [/\bgoal\b/i, /\bhouse\b/i, /\beducation\b/i, /\bvacation\b/i, /\bsave for\b/i, /\btime to goal\b/i],
  },
  {
    template: "taxReview",
    patterns: [/\btax\b/i, /\bcapital gain/i, /\bdividend tax\b/i, /\b80c\b/i, /\bharvest/i],
  },
  {
    template: "scenarioAnalysis",
    patterns: [/\bscenario/i, /\bwhat if\b/i, /\bmonte carlo\b/i, /\bif market\b/i],
  },
  {
    template: "newsSummary",
    patterns: [/\bnews\b/i, /\bheadline/i, /\bearnings this week\b/i, /\bannouncement/i, /\bipo\b/i],
  },
  {
    template: "educational",
    patterns: [
      /\bexplain\b/i,
      /\bwhat is\b/i,
      /\bhow does\b/i,
      /\bhow to\b/i,
      /\bdefinition\b/i,
      /\betf\b/i,
      /\bmutual fund vs\b/i,
      /\bbonds vs\b/i,
    ],
  },
  {
    template: "calculator",
    patterns: [/\bcalculat/i, /\bsip\b/i, /\bhow much.*save\b/i, /\bemi\b/i],
  },
  {
    template: "timeline",
    patterns: [/\btimeline\b/i, /\bhistory\b/i, /\bover time\b/i, /\bevent/i, /\bcatalyst/i],
  },
  {
    template: "companyAnalysis",
    patterns: [
      /\btell me about\b/i,
      /\bfund detail/i,
      /\bstock\b/i,
      /\bvaluation\b/i,
      /\bearnings\b/i,
      /\bpeer\b/i,
      /\bcompetitor/i,
      /\bswot\b/i,
      /\bovervalued\b/i,
    ],
  },
  {
    template: "portfolioAnalysis",
    patterns: [
      /\bperformance\b/i,
      /\breturns?\b/i,
      /\bmonthly\b/i,
      /\bytd\b/i,
      /\b1y\b/i,
      /\bwinners?\b/i,
      /\blosers?\b/i,
      /\bbest\b/i,
      /\bworst\b/i,
    ],
  },
  {
    template: "dashboard",
    patterns: [
      /\bportfolio worth\b/i,
      /\btotal value\b/i,
      /\bnet worth\b/i,
      /\ballocation\b/i,
      /\bdiversif/i,
      /\bholdings\b/i,
      /\bwhere is my money\b/i,
      /\bhealth\b/i,
      /\boverview\b/i,
      /\bshow my\b/i,
    ],
  },
];

/** Map user question → answer template (first match wins; default dashboard). */
export function inferAnswerTemplate(question: string): AnswerTemplate {
  const q = question.trim();
  if (!q) return "dashboard";
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(q))) return rule.template;
  }
  return "dashboard";
}
