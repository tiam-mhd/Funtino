import type { AuthorizationContext } from './authorization-evaluator.js';

export const MFA_STEP_UP_TTL_SECONDS = 5 * 60;
export const MFA_STEP_UP_TTL_MS = MFA_STEP_UP_TTL_SECONDS * 1000;
export const SYSTEM_ADMIN_MFA_SESSION_MAX_SECONDS = 12 * 60 * 60;

export function mfaFreshnessSecondsForContexts(contexts: readonly AuthorizationContext[]): number {
  return contexts.some(
    (context) =>
      context.membership.status === 'active' &&
      context.membership.scope.type === 'global' &&
      context.role.status === 'active' &&
      context.role.scope.type === 'global' &&
      context.role.permissions.includes('system.session_policy.manage'),
  )
    ? SYSTEM_ADMIN_MFA_SESSION_MAX_SECONDS
    : MFA_STEP_UP_TTL_SECONDS;
}
