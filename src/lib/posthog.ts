const apiKey = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN as string | undefined;
const apiHost = import.meta.env.VITE_POSTHOG_HOST as string | undefined;

function isLocalhost() {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

function isPocketEdgeHost() {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "pocketedge.in" || host.endsWith(".pocketedge.in");
}

export const isPostHogEnabled = Boolean(apiKey && apiHost && !isLocalhost());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let posthog: any = null;
let initialized = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let initPromise: Promise<any> | null = null;

async function loadPostHog() {
  if (!isPostHogEnabled) return null;
  if (posthog) return posthog;
  if (!initPromise) {
    initPromise = import("posthog-js").then(({ default: ph }) => {
      posthog = ph;
      return ph;
    });
  }
  return initPromise;
}

/** Anonymous page analytics — no login / identify required. */
export async function initPostHog() {
  if (!isPostHogEnabled || initialized) return posthog;
  const ph = await loadPostHog();
  if (!ph || initialized) return ph;

  ph.init(apiKey, {
    api_host: apiHost,
    defaults: "2026-01-30",
    capture_pageview: true,
    person_profiles: "identified_only",
    cross_subdomain_cookie: isPocketEdgeHost(),
    persistence: "localStorage+cookie",
  });

  ph.register({
    product: "wealth",
    app: "pocketedge_wealth",
  });

  initialized = true;
  return ph;
}

export function captureWealthEvent(
  event: string,
  properties?: Record<string, string | number | boolean | null | undefined>,
) {
  if (!isPostHogEnabled) return;
  void initPostHog().then((ph) => {
    ph?.capture(event, properties);
  });
}

export { posthog };
