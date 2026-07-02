/** Mistral-compatible tool schemas for Munshi Ji (mirrors server/munshi-tools.md). */

const RETURN_FRAMES = {
  type: "array",
  items: {
    type: "string",
    enum: ["MTD", "YTD", "1M", "3M", "6M", "1Y", "3Y", "5Y", "Max"],
  },
  description: "Time frames to include",
};

const BENCHMARK_FRAMES = {
  type: "array",
  items: {
    type: "string",
    enum: ["MTD", "1M", "3M", "6M", "1Y", "3Y", "5Y"],
  },
  description: "Time frames for index or comparison",
};

export const MUNSHI_TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "list_available_data",
      description:
        "List which datasets are loaded: portfolio holdings, NAV, benchmarks, scheme metrics, screener universe, look-through.",
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
      description:
        "Portfolio-level NAV returns: MTD, YTD, 1M, 3M, 6M, 1Y, 3Y, 5Y (month-end series). Use for how the portfolio performed over time.",
      parameters: {
        type: "object",
        properties: {
          frames: RETURN_FRAMES,
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
      name: "list_benchmark_indices",
      description:
        "List all Nifty TRI benchmark indices (nifty50, nifty500, etc.) and whether month-end data is loaded. Use before get_benchmark_returns or get_benchmark_comparison.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_benchmark_returns",
      description:
        "Index-only TRI returns (no portfolio). Use when user asks how Nifty performed, not relative to their portfolio.",
      parameters: {
        type: "object",
        properties: {
          benchmark_id: {
            type: "string",
            description: "e.g. nifty500 (default), nifty50, nifty_midcap_100 — see list_benchmark_indices",
          },
          frames: BENCHMARK_FRAMES,
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_benchmark_comparison",
      description: "Compare your portfolio vs an index (alpha). Use when user asks how they did relative to Nifty/benchmark.",
      parameters: {
        type: "object",
        properties: {
          benchmark_id: {
            type: "string",
            description: "e.g. nifty500 (default), nifty50, nifty100, nifty_midcap_100",
          },
          frames: BENCHMARK_FRAMES,
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_market_funds",
      description:
        "Search ~580 Equity Direct Growth funds in the app screener (not limited to portfolio). Use to discover or compare funds the user does not hold.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Substring match on fund name" },
          category: { type: "string", description: "e.g. Flexi Cap, Large Cap, Mid Cap" },
          sort_by: { type: "string", enum: ["name", "return_1y", "aum", "ter"] },
          limit: { type: "number", description: "Max results (default 15, max 40)" },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_market_fund_details",
      description:
        "Facts for a screener fund by AMFI scheme_code or name query — TER, AUM, returns, holdings. For funds NOT in portfolio or not held.",
      parameters: {
        type: "object",
        properties: {
          scheme_code: { type: "string", description: "AMFI code from search_market_funds, e.g. 120503" },
          name_query: { type: "string", description: "Substring on fund name if code unknown" },
          limit: { type: "number" },
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
      description: "Top/bottom funds in your portfolio by return or weight.",
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
      description:
        "Scheme facts for funds YOU HOLD in the portfolio only. For other funds use get_market_fund_details.",
      parameters: {
        type: "object",
        properties: {
          fund_name_query: { type: "string", description: "Substring match on fund name in portfolio" },
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
      description: "Look-through sector weights for your portfolio.",
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
      description: "Look-through underlying stock weights for your portfolio.",
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
      description: "Calendar year returns for your portfolio (2022, 2023, etc.).",
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
      description: "Sharpe, volatility, max drawdown, current drawdown for your portfolio.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
];
