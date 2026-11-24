/**
 * Site-wide password for hosted demos (D-085). When `SITE_PASSWORD` is set, `src/middleware.ts`
 * asks every visitor for HTTP Basic credentials: any username, that password. Pure, so it is
 * unit-tested without a server.
 */

/** Compares two strings in time that depends only on their lengths, not on where they differ. */
export function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** True when the `Authorization` header carries Basic credentials whose password is `password`. */
export function checkBasicAuth(header: string | null | undefined, password: string): boolean {
  if (!password || !header) return false;
  const [scheme, encoded] = header.trim().split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "basic" || !encoded) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return false;
  }
  const colon = decoded.indexOf(":");
  if (colon < 0) return false;
  return safeEqual(decoded.slice(colon + 1), password);
}

export const SITE_GATE_CHALLENGE = 'Basic realm="DMS demo", charset="UTF-8"';
