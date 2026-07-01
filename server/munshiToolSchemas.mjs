/** Mistral-compatible tool schemas for Munshi Ji (mirrors server/munshi-tools.md). */

export const MUNSHI_TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "list_available_data",
      description: "List which portfolio datasets are loaded (holdings, NAV, benchmarks, scheme metrics, look-through).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_portfolio_summary",
      description: "Current value, invested, gain/loss, XIRR, day change. Use for worth/gain questions — not period returns or benchmarks.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_portfolio_performance",
      description: "Portfolio-level NAV returns: MTD, YTD, 1Y, 3Y, 5Y, since inception.",
      parameters: {
        type: "object",
        properties: {
          include_calendar_years: {
            type: "boolean",
            description: "Include last 6 calendar year returns",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_benchmark_comparison",
      description: "Compare portfolio vs an index (alpha). Only when user asks about benchmark/Nifty/relative performance.",
      parameters: {
        type: "object",
        properties: {
          benchmark_id: {
            type: "string",
            description: "e.g. nifty500 (default), nifty50, nifty100, nifty_midcap_100",
          },
          frames: {
            type: "array",
            items: { type: "string", enum: ["MTD", "1Y", "3Y", "5Y"] },
            description: "Time frames to compare",
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_asset_allocation",
      description: "Equity vs debt vs hybrid allocation percentages.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_portfolio_fundamentals",
      description: "Portfolio-weighted TER, P/E, P/B, YTM, modified duration.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_holdings",
      description: "List mutual fund holdings with weights, values, returns. Use for largest holding, fund list, filters.",
      parameters: {
        type: "object",
        properties: {
          sort_by: { type: "string", enum: ["weight", "return", "invested", "value", "name"] },
          order: { type: "string", enum: ["asc", "desc"] },
          limit: { type: "number" },
          asset_class: { type: "string", description: "Filter e.g. Equity, Debt" },
          category: { type: "string", description: "Substring match on category" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_best_worst_funds",
      description: "Top/bottom funds by return or weight.",
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["best", "worst", "both"] },
          limit: { type: "number" },
          sort_by: { type: "string", enum: ["return", "weight"] },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_fund_details",
      description: "Scheme-level facts: TER, AUM, category, scheme returns, volatility, underlying holdings.",
      parameters: {
        type: "object",
        properties: {
          fund_name_query: { type: "string", description: "Substring match on fund name" },
          rank_by_weight: { type: "number", description: "1 = largest fund by weight" },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_sector_exposure",
      description: "Look-through sector weights.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number" },
          sector_query: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_stock_exposure",
      description: "Look-through underlying stock weights.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number" },
          stock_query: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_year_wise_returns",
      description: "Calendar year returns (2022, 2023, etc.).",
      parameters: {
        type: "object",
        properties: {
          years: { type: "number", description: "Last N years (default 6)" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_risk_metrics",
      description: "Sharpe, volatility, max drawdown, current drawdown.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
];
