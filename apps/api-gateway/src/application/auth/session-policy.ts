export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;
export const SYSTEM_ADMIN_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
export const SYSTEM_ADMIN_MFA_LOGIN_WINDOW_MS = 5 * 60 * 1000;

export function sessionCookieOptions(environment: NodeJS.ProcessEnv = process.env) {
  return {
    httpOnly: true,
    secure: environment.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
    ...(environment.SESSION_COOKIE_DOMAIN ? { domain: environment.SESSION_COOKIE_DOMAIN } : {}),
  };
}
