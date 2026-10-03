export const BOOTSTRAP_CLI_ENABLED_ENV = 'IDENTITY_ACCESS_BOOTSTRAP_ENABLED';

export function isBootstrapCliEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment[BOOTSTRAP_CLI_ENABLED_ENV] === 'true';
}
