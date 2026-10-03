const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_.-]{0,63}$/;
const SAFE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/;
const SENSITIVE_ENV_NAME = /(?:TOKEN|SECRET|PASSWORD|KEYS?|URL)$/i;

type ErrorLike = {
  name?: unknown;
  code?: unknown;
  message?: unknown;
};

export function createStartupFailureEvent(service: string, stage: string, error: unknown) {
  const candidate = asErrorLike(error);
  const rawMessage = typeof candidate.message === 'string' ? candidate.message : '';
  const metricsTokenFailure =
    /^([A-Z][A-Z0-9_]*_METRICS_TOKEN) (is required in production|must contain at least 32 characters)\.$/.exec(
      rawMessage,
    );
  const missingEnvironmentVariable = /Environment variable not found:\s*([A-Z][A-Z0-9_]*)/i.exec(
    rawMessage,
  );
  const invalidPort = /^([A-Z][A-Z0-9_]*_PORT) must be a valid TCP port\.$/.exec(rawMessage);
  const causeCode =
    typeof candidate.code === 'string' && SAFE_ERROR_CODE.test(candidate.code)
      ? candidate.code
      : undefined;
  const errorName =
    typeof candidate.name === 'string' && SAFE_ERROR_NAME.test(candidate.name)
      ? candidate.name
      : 'UnknownError';

  let code: string | undefined;
  let configurationKey: string | undefined;
  if (metricsTokenFailure) {
    configurationKey = metricsTokenFailure[1];
    code =
      metricsTokenFailure[2] === 'is required in production'
        ? 'METRICS_TOKEN_REQUIRED'
        : 'METRICS_TOKEN_TOO_SHORT';
  } else if (missingEnvironmentVariable) {
    configurationKey = missingEnvironmentVariable[1];
    code = 'ENVIRONMENT_VARIABLE_MISSING';
  } else if (invalidPort) {
    configurationKey = invalidPort[1];
    code = 'INVALID_PORT';
  }

  return {
    timestamp: new Date().toISOString(),
    level: 'fatal',
    event: 'service.startup_failed',
    service: safeContext(service),
    stage: safeContext(stage),
    error: {
      name: errorName,
      ...(code ? { code } : {}),
      ...(configurationKey ? { configurationKey } : {}),
      ...(causeCode ? { causeCode } : {}),
      ...(rawMessage ? { message: redactMessage(rawMessage) } : {}),
    },
  };
}

export function reportStartupFailure(service: string, stage: string, error: unknown): void {
  process.stderr.write(`${JSON.stringify(createStartupFailureEvent(service, stage, error))}\n`);
}

function asErrorLike(error: unknown): ErrorLike {
  if (error instanceof Error) return error;
  if (typeof error === 'object' && error !== null) return error as ErrorLike;
  return {};
}

function safeContext(value: string): string {
  return /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? value : 'unknown';
}

function redactMessage(message: string): string {
  let safeMessage = message;
  const sensitiveValues = Object.entries(process.env)
    .filter(
      (entry): entry is [string, string] =>
        Boolean(entry[1]) && entry[1]!.length >= 4 && SENSITIVE_ENV_NAME.test(entry[0]),
    )
    .map(([, value]) => value)
    .sort((left, right) => right.length - left.length);

  for (const value of sensitiveValues) {
    safeMessage = safeMessage.split(value).join('[REDACTED]');
  }

  return safeMessage
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, '[URL_REDACTED]')
    .replace(/\b(?:bearer|basic)\s+\S+/gi, '[AUTH_REDACTED]')
    .replace(/\b(password|token|secret|authorization)\s*[:=]\s*[^,\s;]+/gi, '$1=[REDACTED]')
    .replace(/\s+/g, ' ')
    .slice(0, 300);
}
