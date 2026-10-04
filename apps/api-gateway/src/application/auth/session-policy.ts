export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;
// Management sessions already have an absolute expiry of at most 12 hours. This threshold
// therefore never shortens a configured session based on inactivity.
export const SYSTEM_ADMIN_IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000;
export const SYSTEM_ADMIN_MFA_LOGIN_WINDOW_MS = 5 * 60 * 1000;

export function sessionCookieOptions(
  environment: NodeJS.ProcessEnv = process.env,
  expiresAt?: string,
) {
  const expiresAtMs = expiresAt ? Date.parse(expiresAt) : Number.NaN;
  const maxAge = Number.isFinite(expiresAtMs)
    ? Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000))
    : SESSION_TTL_SECONDS;
  return {
    httpOnly: true,
    secure: environment.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
    ...(environment.SESSION_COOKIE_DOMAIN ? { domain: environment.SESSION_COOKIE_DOMAIN } : {}),
  };
}
