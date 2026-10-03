import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SESSION_TTL_MS,
  SESSION_TTL_SECONDS,
  sessionCookieOptions,
} from '../application/auth/session-policy.js';

test('session persistence and cookie use the same fixed 30-day absolute lifetime', () => {
  assert.equal(SESSION_TTL_MS, 30 * 24 * 60 * 60 * 1000);
  assert.equal(SESSION_TTL_SECONDS, 30 * 24 * 60 * 60);
  const options = sessionCookieOptions({
    NODE_ENV: 'production',
    SESSION_COOKIE_DOMAIN: '.funtino.ir',
  });
  assert.deepEqual(options, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
    domain: '.funtino.ir',
  });
});

test('nonproduction cookie remains HTTP-only and does not invent a shared domain', () => {
  assert.deepEqual(sessionCookieOptions({ NODE_ENV: 'test' }), {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
});
