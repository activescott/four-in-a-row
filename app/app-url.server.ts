/**
 * The app's public origin for links in emails. Production must set APP_URL
 * (a link must never take its host from the request, see #18); dev and tests
 * fall back to the request's own origin.
 */
export function appUrl(request: Request) {
  const configured = process.env.APP_URL;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_URL must be set in production");
  }
  return new URL(request.url).origin;
}
