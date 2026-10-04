const runflareServiceHostnamePattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?-service$/u;

/**
 * Returns true only for an HTTP base URL addressed through a Runflare ClusterIP
 * service alias on port 80. Public HTTP endpoints and URL paths are rejected.
 */
export function isRunflareClusterIpServiceBaseUrl(url: URL): boolean {
  return (
    url.protocol === 'http:' &&
    runflareServiceHostnamePattern.test(url.hostname.toLowerCase()) &&
    (url.port === '' || url.port === '80') &&
    !url.username &&
    !url.password &&
    url.pathname === '/' &&
    !url.search &&
    !url.hash
  );
}
