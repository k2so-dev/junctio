const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isLoopback(url: URL): boolean {
  return LOOPBACK_HOSTS.has(url.hostname) || url.hostname.endsWith(".localhost");
}

export function checkOrigin(request: Request, baseUrl: string | null): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return "invalid origin header";
  }
  if (baseUrl) {
    let expected: URL;
    try {
      expected = new URL(baseUrl);
    } catch {
      return "invalid base url";
    }
    return expected.origin === parsed.origin ? null : "origin not allowed";
  }
  const host = request.headers.get("host");
  if (isLoopback(parsed) && host === parsed.host) return null;
  return "origin not allowed, set JUNCTIO_BASE_URL to accept requests from this origin";
}
