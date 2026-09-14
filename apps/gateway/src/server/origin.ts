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
    try {
      if (new URL(baseUrl).origin === parsed.origin) return null;
    } catch {
      return "invalid base url";
    }
  }
  const host = request.headers.get("host");
  if (host && `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}` === host) return null;
  return "origin not allowed";
}
