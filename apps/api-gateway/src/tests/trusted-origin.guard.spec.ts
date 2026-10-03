import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { TrustedOriginGuard } from '../interfaces/http/trusted-origin.guard.js';

function context(origin?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: origin === undefined ? {} : { origin } }),
    }),
  } as unknown as ExecutionContext;
}

test('MFA mutation guard accepts only an exact configured browser origin', () => {
  const previous = process.env.CORS_ORIGINS;
  process.env.CORS_ORIGINS = 'https://admin.funtino.ir,https://web.funtino.ir';
  try {
    const guard = new TrustedOriginGuard();
    assert.equal(guard.canActivate(context('https://admin.funtino.ir')), true);
    assert.throws(
      () => guard.canActivate(context('https://admin.funtino.ir.attacker.invalid')),
      ForbiddenException,
    );
    assert.throws(
      () => guard.canActivate(context('https://admin.funtino.ir/')),
      ForbiddenException,
    );
    assert.throws(() => guard.canActivate(context()), ForbiddenException);
  } finally {
    if (previous === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = previous;
  }
});

test('MFA mutation guard permits the configured development system origin', () => {
  const previous = process.env.CORS_ORIGINS;
  delete process.env.CORS_ORIGINS;
  try {
    assert.equal(new TrustedOriginGuard().canActivate(context('http://localhost:3002')), true);
  } finally {
    if (previous !== undefined) process.env.CORS_ORIGINS = previous;
  }
});
