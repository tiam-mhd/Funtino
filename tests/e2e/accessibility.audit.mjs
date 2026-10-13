import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(root, 'package.json'));
const apps = [
  {
    name: 'customer-web',
    port: 3000,
    routes: [
      { path: '/fa', state: 'api-unavailable' },
      { path: '/fa/cards?a11y-state=customer-card-error', state: 'cards-error' },
      { path: '/fa/cards?a11y-state=customer-card-empty', state: 'cards-empty' },
      { path: '/fa/cards?a11y-state=customer-card-stale', state: 'cards-stale' },
      {
        path: '/fa/family?a11y-state=customer-family-workspace',
        state: 'customer-family-workspace',
      },
      { path: '/fa/family', state: 'signed-out' },
      { path: '/fa/missions', state: 'signed-out' },
      { path: '/fa/branches', state: 'signed-out' },
      { path: '/fa/account', state: 'signed-out' },
      { path: '/fa/account/profile', state: 'signed-out' },
    ],
  },
  {
    name: 'operations-web',
    port: 3001,
    routes: [
      { path: '/', state: 'api-unavailable' },
      {
        path: '/?a11y-state=operations-empty-scope',
        state: 'empty-scope',
      },
      {
        path: '/?a11y-state=operations-device-stale',
        state: 'stale-device',
        action: 'open-device-workspace',
      },
    ],
  },
  {
    name: 'system-web',
    port: 3002,
    routes: [
      { path: '/', state: 'service-status-unknown' },
      { path: '/fa/organizations?a11y-state=system-organizations-error', state: 'error' },
      { path: '/fa/organizations?a11y-state=system-organizations-empty', state: 'empty' },
      {
        path: '/fa/organizations?a11y-state=system-organizations-stale',
        state: 'stale-data',
        action: 'reload-system-organizations',
      },
      { path: '/fa/system-health?a11y-state=system-health-error', state: 'health-error' },
      { path: '/fa/system-health?a11y-state=system-health-empty', state: 'health-empty' },
      { path: '/fa/system-health?a11y-state=system-health-stale', state: 'health-stale' },
      { path: '/fa/access', state: 'api-unavailable' },
      { path: '/fa/mfa', state: 'api-unavailable' },
    ],
  },
];
const viewports = [
  { name: 'desktop', width: 1440, height: 1000, mobile: false },
  { name: 'mobile', width: 390, height: 844, mobile: true },
];
const appsToAudit = process.env.FUNTINO_A11Y_APP
  ? apps.filter((app) => app.name === process.env.FUNTINO_A11Y_APP)
  : apps;
assert.ok(appsToAudit.length > 0, 'FUNTINO_A11Y_APP did not match a configured web app.');

const fixtureScript = `(() => {
  const originalFetch = window.fetch.bind(window);
  const organizationId = '10000000-0000-4000-8000-000000000001';
  const branchId = '10000000-0000-4000-8000-000000000002';
  const householdId = '10000000-0000-4000-8000-000000000003';
  const memberId = '10000000-0000-4000-8000-000000000004';
  const householdMemberId = '10000000-0000-4000-8000-000000000010';
  const cardId = '10000000-0000-4000-8000-000000000005';
  const deviceId = '10000000-0000-4000-8000-000000000006';
  const now = '2026-09-30T08:00:00.000Z';
  const state = new URL(location.href).searchParams.get('a11y-state');
  const success = (data, nextCursor) => new Response(JSON.stringify({
    status: 'success', data, ...(nextCursor === undefined ? {} : { nextCursor }),
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  const failure = () => new Response(JSON.stringify({
    status: 'error', error: { message: 'Synthetic accessibility fixture: request unavailable.' },
  }), { status: 503, headers: { 'content-type': 'application/json' } });
  const organization = {
    id: organizationId, name: 'A11y Fixture Organization', slug: 'a11y-fixture',
    timezone: 'Asia/Tehran', status: 'active', version: 1, createdAt: now, updatedAt: now,
  };
  const branch = {
    id: branchId, organizationId, name: 'A11y Fixture Branch', city: 'Tehran',
  };
  const scopeOption = {
    scope: { type: 'branch', organizationId, branchId },
    organization, branch,
  };

  window.__funtinoA11yRequestCounts = Object.create(null);
  window.__funtinoA11yState = state;
  window.fetch = async (input, init) => {
    const requestValue = typeof input === 'string' ? input : input?.href ?? input?.url ?? String(input);
    let requestUrl;
    try {
      requestUrl = new URL(requestValue, location.href);
    } catch (error) {
      window.__funtinoA11yFetchError = String(error);
      return originalFetch(input, init);
    }
    if (requestUrl.pathname.includes('/api/')) {
      window.__funtinoA11yLastInput = {
        type: typeof input,
        constructor: input?.constructor?.name,
        requestValue,
        pathname: requestUrl.pathname,
      };
    }
    if (!requestUrl.pathname.startsWith('/api/v1/')) return originalFetch(input, init);
    const path = requestUrl.pathname;
    window.__funtinoA11yRequestCounts[path] = (window.__funtinoA11yRequestCounts[path] ?? 0) + 1;
    const count = window.__funtinoA11yRequestCounts[path];

    if (
      path === '/api/v1/customer/profile' &&
      (state?.startsWith('customer-card-') || state === 'customer-family-workspace')
    ) {
      return success({
        id: '10000000-0000-4000-8000-000000000007', phoneE164: '+989120000000',
        displayName: 'A11y Test Customer', firstName: 'A11y', lastName: 'Customer',
        email: null, birthDate: '1990-01-01', gender: 'prefer_not_to_say', city: 'Tehran',
        avatarPreset: 'sun', avatarUrl: null, avatarUpdatedAt: null,
        profileCompletedAt: now, profileCompleted: true, createdAt: now,
      });
    }
    if (path === '/api/v1/customer/cards' && state?.startsWith('customer-card-')) {
      if (state === 'customer-card-error') return failure();
      if (state === 'customer-card-empty') return success([]);
      return success([{
        id: cardId, householdId, memberId: null, branchId,
        maskedCardId: '\\u2022\\u2022\\u2022\\u2022 \\u2022\\u2022\\u2022\\u2022 1234',
        status: 'active', lastSyncedAt: '2026-09-28T08:00:00.000Z',
        walletId: '10000000-0000-4000-8000-000000000008', isStale: true,
        freshness: 'stale',
      }]);
    }
    if (path === '/api/v1/customer/households' && state?.startsWith('customer-card-')) {
      return success([{ id: householdId, name: 'A11y Test Household', members: [{ id: memberId, displayName: 'A11y Test Member' }] }]);
    }
    if (path === '/api/v1/customer/branches' && state?.startsWith('customer-card-')) {
      return success([{ id: branchId, name: 'A11y Fixture Branch', status: 'open' }]);
    }
    if (path === '/api/v1/customer/family' && state === 'customer-family-workspace') {
      return success({
        items: [
          {
            id: householdId,
            name: 'A11y Test Household',
            status: 'active',
            version: 1,
            createdAt: now,
            accessRole: 'owner',
            canManage: true,
            viewerMemberId: memberId,
            members: [
              {
                id: memberId,
                householdId,
                displayName: 'A11y Parent',
                relationship: 'خودم',
                relationshipLabel: 'من',
                relationshipStatus: 'verified',
                displayGender: 'female',
                isAccountLinked: true,
                isViewer: true,
                birthDate: null,
                status: 'active',
                isDependent: false,
                version: 1,
                createdAt: now,
              },
              {
                id: householdMemberId,
                householdId,
                displayName: 'A11y Child',
                relationship: 'فرزند',
                relationshipLabel: 'دختر',
                relationshipStatus: 'verified',
                displayGender: 'female',
                isAccountLinked: false,
                isViewer: false,
                birthDate: null,
                status: 'active',
                isDependent: true,
                version: 1,
                createdAt: now,
              },
            ],
            relationships: [
              {
                id: '10000000-0000-4000-8000-000000000011',
                fromMemberId: memberId,
                toMemberId: householdMemberId,
                kind: 'parent',
                basis: 'biological',
              },
            ],
            invitations: [],
          },
        ],
        invitations: [],
      });
    }

    if (path === '/api/v1/auth/me' && state?.startsWith('operations-')) {
      return success({
        id: '10000000-0000-4000-8000-000000000009', phoneE164: '+989120000000',
        displayName: 'A11y Test Operator', firstName: 'A11y', lastName: 'Operator',
      });
    }
    if (path === '/api/v1/operations/scopes' && state?.startsWith('operations-')) {
      return success({ items: state === 'operations-empty-scope' ? [] : [{ ...scopeOption }], policyVersion: 1 });
    }
    if (path === '/api/v1/operations/scope-selection' && state === 'operations-device-stale') {
      return success({ ...scopeOption, policyVersion: 1 });
    }
    if (path === '/api/v1/operations/staff/invitations/pending' && state?.startsWith('operations-')) {
      return success({ data: [] });
    }
    if (path === '/api/v1/operations/devices' && state === 'operations-device-stale') {
      return success({
        items: [{
          id: deviceId, organizationId, branchId, adapterKey: 'a11y-fixture',
          externalDeviceId: 'fixture-device-01', displayName: 'A11y Fixture Device',
          deviceType: 'rfid_reader', status: 'active', healthState: 'stale',
          latestReportedState: 'online', latestObservedAt: '2026-09-27T08:00:00.000Z',
          freshnessSeconds: 86400, version: 1, createdAt: now, updatedAt: now,
        }],
        capabilities: { canRegister: false, canManage: false, canReadBranches: false },
      }, null);
    }

    if (path === '/api/v1/system/organizations' && state?.startsWith('system-organizations-')) {
      if (state === 'system-organizations-error' || (state === 'system-organizations-stale' && count > 1)) {
        return failure();
      }
      const items = state === 'system-organizations-empty' ? [] : [organization];
      return success({ items, nextCursor: null });
    }

    if (path === '/api/v1/system/health' && state?.startsWith('system-health-')) {
      if (state === 'system-health-error') return failure();
      const serviceKeys = [
        'api-gateway', 'realtime-gateway', 'device-integration', 'wallet', 'notifications',
        'identity-access', 'organization-branch', 'analytics-read-model', 'rabbitmq',
        'prometheus', 'alertmanager', 'grafana',
      ];
      const services = serviceKeys.map((key) => {
        const stale = state === 'system-health-stale' && key === 'api-gateway';
        const empty = state === 'system-health-empty';
        return {
          key, name: key, status: empty ? 'unknown' : stale ? 'stale' : 'healthy',
          targets: empty ? 0 : 1, unavailableTargets: 0,
          requestsPerSecond: empty ? null : 1, serverErrorPercent: null,
          p95LatencyMs: empty ? null : 80, freshnessSeconds: empty ? null : stale ? 120 : 8,
          lastScrapedAt: empty ? null : now,
        };
      });
      return success({ observedAt: now, source: 'prometheus', services, activeAlerts: [] });
    }

    return originalFetch(input, init);
  };
})();`;

function findBrowser() {
  const candidates = [
    process.env.EDGE_EXECUTABLE,
    path.join(
      process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)',
      'Microsoft/Edge/Application/msedge.exe',
    ),
    path.join(
      process.env.PROGRAMFILES ?? 'C:\\Program Files',
      'Microsoft/Edge/Application/msedge.exe',
    ),
  ].filter(Boolean);
  return candidates.find((candidate) => require('node:fs').existsSync(candidate));
}

async function waitForHttp(url, child, label) {
  const deadline = Date.now() + 60_000;
  let lastStatus = null;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(
        label + ' exited before it was ready. Startup output: ' + child.startupOutput,
      );
    }
    try {
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(1_500) });
      if (response.status < 400) return;
      lastStatus = response.status;
      lastError = (await response.text()).slice(0, 2_000);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(
    label +
      ' did not become ready within 60 seconds. Last status: ' +
      String(lastStatus) +
      '. Last response: ' +
      String(lastError) +
      '. Startup output: ' +
      child?.startupOutput ?? 'No process was started by this test.',
  );
}

async function runProcess(executable, args, options, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, options);
    let output = '';
    const capture = (chunk) => {
      output = (output + String(chunk)).slice(-16_000);
    };
    child.stdout?.on('data', capture);
    child.stderr?.on('data', capture);
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(label + ' failed with exit code ' + code + ':\n' + output));
    });
  });
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve a local port.');
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function stopTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
  } else {
    child.kill('SIGTERM');
  }
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
}

class DevtoolsPage {
  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject, timeout } = this.pending.get(message.id);
        clearTimeout(timeout);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      }
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    return new DevtoolsPage(socket);
  }

  call(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('DevTools command timed out: ' + method));
      }, 20_000);
      this.pending.set(id, { resolve, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.call('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error('Browser evaluation failed.');
    return result.result?.value;
  }

  close() {
    this.socket.close();
  }
}

async function waitForExpression(page, expression, label) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      if (await page.evaluate(expression)) return;
    } catch {
      // Keep waiting while the route hydrates or a fixture response settles.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const browserState = await page
    .evaluate(
      "JSON.stringify({ href: location.href, state: window.__funtinoA11yState, counts: window.__funtinoA11yRequestCounts, lastInput: window.__funtinoA11yLastInput, fetchError: window.__funtinoA11yFetchError, apiEntries: performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/api/')).map((entry) => entry.name), text: document.body?.innerText?.slice(0, 1200) ?? '' })",
    )
    .catch(() => 'unavailable');
  throw new Error(
    label + ' did not reach its expected browser state. Current page: ' + browserState,
  );
}

async function setViewport(page, viewport) {
  await page.call('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: viewport.mobile,
  });
}

async function exerciseRouteState(page, app, route) {
  if (app.name === 'customer-web' && route.state === 'customer-family-workspace') {
    await waitForExpression(
      page,
      "document.querySelector('main')?.innerText.includes('A11y Test Household') && document.querySelector('main')?.innerText.includes('A11y Child')",
      app.name + ' family workspace fixture',
    );
    return;
  }

  if (app.name === 'customer-web' && route.state.startsWith('cards-')) {
    const expectedClass = {
      'cards-error': 'customer-cards-feedback--error',
      'cards-empty': 'customer-cards-feedback--empty',
      'cards-stale': 'customer-owned-card',
    }[route.state];
    await waitForExpression(
      page,
      `Boolean(document.querySelector('.customer-cards-page .${expectedClass}'))`,
      app.name + ' ' + route.state,
    );
    return;
  }

  if (app.name === 'operations-web' && route.action === 'open-device-workspace') {
    await waitForExpression(
      page,
      "Boolean(document.querySelector('#scope-title')?.closest('section')?.querySelector('button'))",
      app.name + ' scope picker',
    );
    await page.evaluate(
      "document.querySelector('#scope-title')?.closest('section')?.querySelector('button')?.click()",
    );
    await waitForExpression(
      page,
      "Boolean(document.querySelector('#operations-sidebar'))",
      app.name + ' active scope',
    );
    await page.evaluate(
      "if (matchMedia('(max-width: 900px)').matches) document.querySelector('button[aria-controls=operations-sidebar]')?.click()",
    );
    await waitForExpression(
      page,
      "Array.from(document.querySelectorAll('#operations-sidebar:not([inert]) button[data-nav-item]')).some((button) => button.textContent?.includes('دستگاه‌ها و پایش'))",
      app.name + ' device navigation',
    );
    await page.evaluate(
      "Array.from(document.querySelectorAll('#operations-sidebar:not([inert]) button[data-nav-item]')).find((button) => button.textContent?.includes('دستگاه‌ها و پایش'))?.click()",
    );
    await waitForExpression(
      page,
      "Array.from(document.querySelectorAll('h3')).some((heading) => heading.textContent?.includes('A11y Fixture Device'))",
      app.name + ' stale device row',
    );
    return;
  }

  if (app.name === 'operations-web' && route.state === 'empty-scope') {
    await waitForExpression(
      page,
      `Boolean(document.querySelector('main [class*="stateCard"] h1')) && !document.querySelector('#scope-title')`,
      app.name + ' empty scope state',
    );
    return;
  }

  if (app.name === 'system-web' && route.state === 'empty') {
    await waitForExpression(
      page,
      `Boolean(document.querySelector('main [class*="empty"]'))`,
      app.name + ' empty organizations state',
    );
    return;
  }

  if (app.name === 'system-web' && route.state === 'error') {
    await waitForExpression(
      page,
      "Boolean(document.querySelector('[role=alert]'))",
      app.name + ' error state',
    );
    return;
  }

  if (app.name === 'system-web' && route.state === 'health-error') {
    await waitForExpression(
      page,
      "Boolean(document.querySelector('[role=alert]'))",
      app.name + ' telemetry unavailable state',
    );
    return;
  }

  if (app.name === 'system-web' && route.state === 'health-empty') {
    await waitForExpression(
      page,
      "Boolean(document.querySelector('[class*=emptyAlerts]'))",
      app.name + ' no active alerts state',
    );
    return;
  }

  if (app.name === 'system-web' && route.state === 'health-stale') {
    await waitForExpression(
      page,
      "Boolean(document.querySelector('main')?.innerText.includes('داده قدیمی'))",
      app.name + ' stale telemetry state',
    );
    return;
  }

  if (app.name === 'system-web' && route.action === 'reload-system-organizations') {
    await waitForExpression(
      page,
      "Boolean(document.querySelector('main')?.innerText.includes('A11y Fixture Organization'))",
      app.name + ' loaded synthetic organization',
    );
    await page.evaluate("document.querySelector('main button:not([disabled])')?.click()");
    await waitForExpression(
      page,
      "Boolean(document.querySelector('[role=alert]')) && document.querySelector('main')?.innerText.includes('A11y Fixture Organization')",
      app.name + ' stale organizations state',
    );
  }
}

async function auditKeyboardTraversal(page) {
  await page.evaluate('document.activeElement?.blur(); window.scrollTo(0, 0)');
  const totalFocusable = await page.evaluate(`(() => {
    const selector = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll(selector)).filter((element) => {
      const style = getComputedStyle(element);
      return element.getClientRects().length > 0 && style.visibility !== 'hidden' &&
        style.display !== 'none' && !element.closest('[inert],[aria-hidden="true"]') &&
        !(element instanceof HTMLInputElement && element.type === 'radio' && !element.checked);
    }).length;
  })()`);
  const visited = new Set();
  const failures = [];
  const targets = [];

  for (let index = 0; index < Math.min(totalFocusable + 1, 100); index += 1) {
    await page.call('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
    });
    await page.call('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Tab',
      code: 'Tab',
      windowsVirtualKeyCode: 9,
      nativeVirtualKeyCode: 9,
    });
    const focus = await page.evaluate(`(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement) || element === document.body || element === document.documentElement) return null;
      const style = getComputedStyle(element);
      const outline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
      const visibleFocus = element.matches(':focus-visible');
      const path = [];
      for (let node = element; node && node !== document.body; node = node.parentElement) {
        const siblingIndex = Array.from(node.parentElement?.children ?? []).indexOf(node) + 1;
        path.unshift(node.tagName.toLowerCase() + ':nth-child(' + siblingIndex + ')');
      }
      return {
        signature: path.join('>'),
        label: (element.getAttribute('aria-label') || element.innerText || element.getAttribute('href') || element.tagName).trim().slice(0, 80),
        focusVisible: visibleFocus,
        focusStyle: outline || style.boxShadow !== 'none',
      };
    })()`);
    if (!focus || visited.has(focus.signature)) break;
    visited.add(focus.signature);
    targets.push(focus.label);
    if (!focus.focusVisible || !focus.focusStyle) failures.push(focus.label);
  }

  return { totalFocusable, visited: visited.size, targets, failures };
}

async function resolveAxeCoreModule() {
  const searchPaths = [root];
  const pnpmStore = path.join(root, 'node_modules', '.pnpm');
  for (const entry of await fs.readdir(pnpmStore)) {
    if (entry.startsWith('axe-core@')) {
      searchPaths.push(path.join(pnpmStore, entry, 'node_modules'));
    }
  }
  for (const searchPath of searchPaths) {
    try {
      return require.resolve('axe-core', { paths: [searchPath] });
    } catch {
      // pnpm may keep the root dev dependency in its content-addressed store.
    }
  }
  throw new Error('axe-core is declared by the repository but is not installed.');
}

const browser = findBrowser();
assert.ok(browser, 'Microsoft Edge is required for the accessibility gate.');
const tempProfile = await fs.mkdtemp(path.join(os.tmpdir(), 'funtino-a11y-edge-'));
const servers = [];
const generatedBuildDirs = [];
const generatedConfigFiles = [];
const buildWarnings = [];
let browserProcess;
let page;

try {
  for (const app of appsToAudit) {
    app.port = await reservePort();
    const appRoot = path.join(root, 'apps', app.name);
    for (const fileName of ['next-env.d.ts', 'tsconfig.json']) {
      const filePath = path.resolve(appRoot, fileName);
      assert.equal(path.dirname(filePath), path.resolve(appRoot));
      try {
        generatedConfigFiles.push({ filePath, contents: await fs.readFile(filePath) });
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        generatedConfigFiles.push({ filePath, contents: null });
      }
    }
    const nextCli = require.resolve('next/dist/bin/next', { paths: [appRoot] });
    app.distDir = '.next-a11y-' + process.pid + '-' + randomUUID();
    const exactBuildDirectory = path.resolve(appRoot, app.distDir);
    assert.equal(path.dirname(exactBuildDirectory), path.resolve(appRoot));
    try {
      await fs.access(exactBuildDirectory);
      throw new Error('Refusing to overwrite an existing isolated audit build.');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    generatedBuildDirs.push({ appRoot, distDir: app.distDir });
    const appEnvironment = {
      ...process.env,
      NODE_ENV: 'production',
      NEXT_PUBLIC_API_BASE_URL: 'https://127.0.0.1:1',
      NEXT_PUBLIC_DATA_MODE: 'api',
      FUNTINO_A11Y_DIST_DIR: app.distDir,
    };
    const buildOutput = await runProcess(
      process.execPath,
      [nextCli, 'build'],
      { cwd: appRoot, env: appEnvironment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
      app.name + ' isolated production build',
    );
    if (buildOutput.includes("Failed to load plugin 'react-hooks'")) {
      buildWarnings.push({
        app: app.name,
        warning: 'Next build could not load the configured eslint-plugin-react-hooks dependency.',
      });
    }
    const child = spawn(
      process.execPath,
      [nextCli, 'start', '-p', String(app.port), '-H', '127.0.0.1'],
      {
        cwd: appRoot,
        env: appEnvironment,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    child.startupOutput = '';
    const captureStartup = (chunk) => {
      child.startupOutput = (child.startupOutput + String(chunk)).slice(-8_000);
    };
    child.stdout?.on('data', captureStartup);
    child.stderr?.on('data', captureStartup);
    servers.push(child);
    await waitForHttp('http://127.0.0.1:' + app.port + app.routes[0].path, child, app.name);
  }

  const devtoolsPort = await reservePort();
  browserProcess = spawn(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=' + devtoolsPort,
      '--user-data-dir=' + tempProfile,
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true },
  );

  const versionUrl = 'http://127.0.0.1:' + devtoolsPort + '/json/version';
  let version;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (browserProcess.exitCode !== null)
      throw new Error('Edge exited before DevTools became ready.');
    try {
      version = await (await fetch(versionUrl)).json();
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  assert.ok(version?.webSocketDebuggerUrl, 'Edge DevTools endpoint did not start.');
  const targetResponse = await fetch('http://127.0.0.1:' + devtoolsPort + '/json/new?about:blank', {
    method: 'PUT',
  });
  assert.ok(targetResponse.ok, 'Could not create a private browser tab.');
  const target = await targetResponse.json();
  page = await DevtoolsPage.connect(target.webSocketDebuggerUrl);
  await page.call('Page.enable');
  await page.call('Runtime.enable');
  await page.call('Page.addScriptToEvaluateOnNewDocument', { source: fixtureScript });

  const axePath = path.join(path.dirname(await resolveAxeCoreModule()), 'axe.min.js');
  const axeSource = await fs.readFile(axePath, 'utf8');
  const blocking = [];
  const summaries = [];

  for (const app of appsToAudit) {
    const selectedRoutes = process.env.FUNTINO_A11Y_STATE
      ? app.routes.filter((route) => route.state === process.env.FUNTINO_A11Y_STATE)
      : app.routes;
    assert.ok(selectedRoutes.length > 0, 'FUNTINO_A11Y_STATE did not match a configured route.');
    for (const route of selectedRoutes) {
      for (const viewport of viewports) {
        await setViewport(page, viewport);
        const url = 'http://127.0.0.1:' + app.port + route.path;
        await page.call('Page.navigate', { url });
        await waitForExpression(
          page,
          "document.readyState === 'complete' && !!document.body && document.body.innerText.length > 0",
          app.name + ' ' + route.path,
        );
        await exerciseRouteState(page, app, route);
        await page.evaluate(`Promise.all(document.getAnimations()
          .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
          .map((animation) => animation.finished.catch(() => undefined)))`);

        const pageFacts = await page.evaluate(`(() => {
          const root = document.documentElement;
          return {
            lang: root.lang,
            dir: root.dir,
            computedDirection: getComputedStyle(root).direction,
            viewportWidth: root.clientWidth,
            documentWidth: root.scrollWidth,
            bodyWidth: document.body.scrollWidth,
            overflowingElements: Array.from(document.querySelectorAll('body *'))
              .map((element) => {
                const rect = element.getBoundingClientRect();
                return {
                  tag: element.tagName.toLowerCase(),
                  id: element.id,
                  className: element.getAttribute('class') ?? '',
                  left: Math.round(rect.left),
                  right: Math.round(rect.right),
                  width: Math.round(rect.width),
                  scrollWidth: element.scrollWidth,
                };
              })
              .filter((element) => element.right > root.clientWidth + 1)
              .sort((left, right) => right.right - left.right)
              .slice(0, 12),
          };
        })()`);
        if (
          !pageFacts.lang.toLowerCase().startsWith('fa') ||
          pageFacts.dir !== 'rtl' ||
          pageFacts.computedDirection !== 'rtl'
        ) {
          blocking.push({
            app: app.name,
            route: route.path,
            viewport: viewport.name,
            id: 'document-language-or-direction',
            facts: pageFacts,
          });
        }
        if (viewport.mobile && pageFacts.documentWidth > pageFacts.viewportWidth + 1) {
          blocking.push({
            app: app.name,
            route: route.path,
            viewport: viewport.name,
            id: 'horizontal-overflow',
            facts: pageFacts,
          });
        }

        await page.evaluate('eval(' + JSON.stringify(axeSource) + '); typeof globalThis.axe');
        const result = await page.evaluate(
          "globalThis.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } })",
        );
        const violations = result.violations ?? [];
        const severe = violations.filter(
          (item) => item.impact === 'critical' || item.impact === 'serious',
        );
        const keyboard = viewport.name === 'desktop' ? await auditKeyboardTraversal(page) : null;
        summaries.push({
          app: app.name,
          route: route.path,
          state: route.state,
          viewport: viewport.name,
          rtl: pageFacts.dir === 'rtl' && pageFacts.computedDirection === 'rtl',
          horizontalOverflow:
            viewport.mobile && pageFacts.documentWidth > pageFacts.viewportWidth + 1,
          violations: violations.length,
          seriousOrCritical: severe.length,
          keyboard,
          nonBlockingFindings: violations
            .filter((item) => item.impact !== 'critical' && item.impact !== 'serious')
            .map((item) => ({ id: item.id, impact: item.impact, nodes: item.nodes.length })),
        });
        for (const violation of severe) {
          blocking.push({
            app: app.name,
            route: route.path,
            viewport: viewport.name,
            id: violation.id,
            impact: violation.impact,
            help: violation.help,
            affectedElements: violation.nodes.length,
            nodes: violation.nodes.slice(0, 8).map((node) => ({
              target: node.target,
              failureSummary: node.failureSummary,
              html: node.html,
              contrast: node.any?.find((check) => check.id === 'color-contrast')?.data,
            })),
          });
        }
        if (keyboard && keyboard.failures.length > 0) {
          blocking.push({
            app: app.name,
            route: route.path,
            viewport: viewport.name,
            id: 'keyboard-focus-not-visible',
            affectedElements: keyboard.failures.length,
            targets: keyboard.failures,
          });
        }
        if (keyboard && keyboard.visited !== keyboard.totalFocusable) {
          blocking.push({
            app: app.name,
            route: route.path,
            viewport: viewport.name,
            id: 'keyboard-tab-order-incomplete',
            expectedTabStops: keyboard.totalFocusable,
            visitedTabStops: keyboard.visited,
          });
        }
      }
    }
  }

  process.stdout.write(
    JSON.stringify(
      { status: blocking.length ? 'failed' : 'passed', buildWarnings, summaries, blocking },
      null,
      2,
    ) + '\n',
  );
  assert.equal(blocking.length, 0, 'Critical or serious accessibility violations were found.');
} finally {
  page?.close();
  if (browserProcess) await stopTree(browserProcess);
  for (const server of servers.reverse()) await stopTree(server);
  for (const file of generatedConfigFiles.reverse()) {
    if (file.contents === null) await fs.rm(file.filePath, { force: true });
    else await fs.writeFile(file.filePath, file.contents);
  }
  for (const build of generatedBuildDirs) {
    const exactBuildDirectory = path.resolve(build.appRoot, build.distDir);
    if (
      path.dirname(exactBuildDirectory) === path.resolve(build.appRoot) &&
      path.basename(exactBuildDirectory).startsWith('.next-a11y-' + process.pid + '-')
    ) {
      await fs.rm(exactBuildDirectory, { recursive: true, force: true });
    }
  }
  const exactTemporaryDirectory = path.resolve(tempProfile);
  if (
    path.dirname(exactTemporaryDirectory) === path.resolve(os.tmpdir()) &&
    path.basename(exactTemporaryDirectory).startsWith('funtino-a11y-edge-')
  ) {
    await fs.rm(exactTemporaryDirectory, { recursive: true, force: true });
  }
}
