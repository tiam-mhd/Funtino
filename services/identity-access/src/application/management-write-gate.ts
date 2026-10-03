export const MANAGEMENT_WRITES_ENABLED_ENV = 'IDENTITY_ACCESS_MANAGEMENT_WRITES_ENABLED';

/** Non-production remains available for development and CI; production is explicit opt-in. */
export function areManagementWritesEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  if (environment.NODE_ENV === 'development' || environment.NODE_ENV === 'test') return true;
  return environment[MANAGEMENT_WRITES_ENABLED_ENV] === 'true';
}
