import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { MfaCryptoService } from '../application/mfa-crypto.service.js';
import { MfaService } from '../application/mfa.service.js';
import { AccessMutationJournalService } from '../application/access-mutation-journal.service.js';
import { PrismaService } from '../infrastructure/persistence/prisma/prisma.service.js';
import { AccessBootstrapService } from './access-bootstrap.service.js';
import { isBootstrapCliEnabled } from './bootstrap-cli-policy.js';

const userIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function readHidden(prompt: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    throw new Error('Finalize must run in an interactive terminal so the MFA code is not echoed.');
  }
  process.stdout.write(prompt);
  try {
    input.setRawMode(true);
  } catch {
    try { input.setRawMode(false); } catch { /* Keep the original terminal setup error private. */ }
    throw new Error('Interactive terminal could not be prepared for hidden MFA input.');
  }
  return new Promise((resolve, reject) => {
    let value = '';
    let overflowCount = 0;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      input.off('data', onData);
      input.off('end', onEnd);
      input.off('error', onError);
      try {
        input.setRawMode(false);
      } catch {
        error ??= new Error('Interactive terminal mode could not be restored.');
      } finally {
        input.pause();
        process.stdout.write('\n');
      }
      if (error) reject(error);
      else if (overflowCount > 0) reject(new Error('The MFA proof is too long.'));
      else resolve(value.trim());
    };
    const onData = (chunk: Buffer | string) => {
      const text = chunk.toString('utf8');
      for (const character of text) {
        if (character === '\u0003') {
          finish(new Error('Bootstrap was cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          return;
        }
        if (character === '\u007f' || character === '\b') {
          if (overflowCount > 0) overflowCount -= 1;
          else value = value.slice(0, -1);
          continue;
        }
        if (character >= ' ') {
          if (value.length < 35) value += character;
          else overflowCount += 1;
        }
      }
    };
    const onEnd = () => finish(new Error('Interactive input ended before verification.'));
    const onError = () => finish(new Error('Interactive input failed before verification.'));
    input.on('data', onData);
    input.once('end', onEnd);
    input.once('error', onError);
    try {
      input.resume();
    } catch {
      finish(new Error('Interactive input could not be started.'));
    }
  });
}

function validateArgs(command: string | undefined, userId: string | undefined, operatorLabel: string | undefined, reason: string): asserts command is 'prepare' | 'finalize' {
  if (command !== 'prepare' && command !== 'finalize') {
    throw new Error('Usage: iam:bootstrap <prepare|finalize> <user-uuid> <operator-label> <audit-reason>');
  }
  if (!userId || !userIdPattern.test(userId)) throw new Error('A valid previously verified user UUID is required.');
  if (!operatorLabel || operatorLabel.trim().length < 2 || operatorLabel.trim().length > 100 || /[\r\n]/.test(operatorLabel)) {
    throw new Error('Provide a 2-100 character operator label or ticket reference.');
  }
  if (reason.trim().length < 8 || reason.trim().length > 500) throw new Error('Audit reason must contain 8-500 characters.');
}

async function main(): Promise<void> {
  const [, , ...rawArgs] = process.argv;
  // pnpm versions differ in whether they preserve the conventional script separator.
  const [command, userId, operatorLabel, ...reasonParts] =
    rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
  const reason = reasonParts.join(' ');
  validateArgs(command, userId, operatorLabel, reason);
  if (!isBootstrapCliEnabled()) {
    throw new Error('Set IDENTITY_ACCESS_BOOTSTRAP_ENABLED=true only for this audited one-off CLI invocation.');
  }
  if (!process.stdin.isTTY) {
    throw new Error('Bootstrap must run in an interactive terminal.');
  }

  const mfaCrypto = new MfaCryptoService();
  if (!mfaCrypto.isConfigured()) throw new Error('MFA encryption keyring is not configured; bootstrap fails closed.');
  const prisma = new PrismaService();
  try {
    await prisma.$connect();
    const mfa = new MfaService(prisma, mfaCrypto);
    const bootstrap = new AccessBootstrapService(prisma, new AccessMutationJournalService(), mfa);
    if (command === 'prepare') {
      const result = await bootstrap.prepare({ userId: userId!, operatorLabel: operatorLabel!.trim(), reason: reason.trim() });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.stdout.write('Complete TOTP enrollment and run finalize within 24 hours; remove the one-off bootstrap flag after this command.\n');
      return;
    }

    const code = await readHidden('TOTP or one-time recovery code: ');
    const method = /^\d{6}$/.test(code) ? 'totp' : 'recovery';
    const result = await bootstrap.finalize({
      userId: userId!, operatorLabel: operatorLabel!.trim(), reason: reason.trim(), code, method,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof HttpException
    ? error.message
    : error instanceof Error && /^(Usage:|A valid previously|Provide a |Audit reason|Set IDENTITY_ACCESS|Bootstrap must run|Finalize must run|The MFA proof|Bootstrap was cancelled|Interactive input)/.test(error.message)
      ? error.message
      : 'Bootstrap failed; runtime details were withheld to protect credentials.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
