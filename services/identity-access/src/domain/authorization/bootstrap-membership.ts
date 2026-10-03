export const SYSTEM_ADMIN_BOOTSTRAP_ROLE_NAME = 'system_admin_bootstrap';
export const BOOTSTRAP_MEMBERSHIP_TTL_MS = 24 * 60 * 60 * 1000;

export function isBootstrapMembershipExpired(
  roleName: string,
  createdAt: Date,
  now: Date = new Date(),
): boolean {
  if (roleName !== SYSTEM_ADMIN_BOOTSTRAP_ROLE_NAME) return false;
  const createdAtMs = createdAt.getTime();
  return (
    !Number.isFinite(createdAtMs) || createdAtMs + BOOTSTRAP_MEMBERSHIP_TTL_MS <= now.getTime()
  );
}

export function isEffectiveActiveMembership(
  membership: { status: string; createdAt: Date; roleName: string },
  now: Date = new Date(),
): boolean {
  return (
    membership.status === 'active' &&
    !isBootstrapMembershipExpired(membership.roleName, membership.createdAt, now)
  );
}
