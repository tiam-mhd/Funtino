import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  EDGE_OPERATOR_PAIRING_REPOSITORY,
  type EdgeOperatorPairingRecord,
  type EdgeOperatorPairingRepository,
} from './ports/edge-operator-pairing.repository.js';

const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

@Injectable()
export class EdgeOperatorPairingService {
  constructor(
    @Inject(EDGE_OPERATOR_PAIRING_REPOSITORY)
    private readonly repository: EdgeOperatorPairingRepository,
  ) {}

  async start(input: { sourceInstanceId: string; organizationId: string; branchId: string }) {
    const bytes = randomBytes(10);
    const code = Array.from(bytes, (value) => codeAlphabet[value & 31]).join('');
    bytes.fill(0);
    const pollSecret = randomBytes(32).toString('base64url');
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    await this.repository.createPending({
      id,
      sourceInstanceId: input.sourceInstanceId,
      organizationId: input.organizationId,
      branchId: input.branchId,
      pairingCodeHash: sha256(code),
      pollSecretHash: sha256(pollSecret),
      expiresAt,
    });
    return {
      pairingId: id,
      userCode: code.slice(0, 5) + '-' + code.slice(5),
      pollSecret,
      expiresAt: expiresAt.toISOString(),
      pollIntervalSeconds: 3,
    };
  }

  async approve(input: {
    code: string;
    organizationId: string;
    branchId: string;
    actorUserId: string;
    managementSessionId: string;
    permissionKeys: string[];
    idempotencyKey: string;
    correlationId: string;
  }) {
    const code = normalizeCode(input.code);
    if (!code) throw new NotFoundException('کد اتصال معتبر نیست یا اعتبار آن پایان یافته است.');
    const pairingCodeHash = sha256(code);
    const permissionKeys = [...new Set(input.permissionKeys)].sort();
    const requestHash = sha256(
      JSON.stringify([
        pairingCodeHash,
        input.organizationId.toLowerCase(),
        input.branchId.toLowerCase(),
        input.actorUserId.toLowerCase(),
        input.managementSessionId.toLowerCase(),
        permissionKeys,
      ]),
    );
    const replay = await this.repository.findByApprovalIdempotencyKey(input.idempotencyKey);
    if (replay) {
      if (replay.approvalRequestHash !== requestHash || replay.actorUserId !== input.actorUserId)
        throw new ConflictException('کلید تکرار برای درخواست دیگری استفاده شده است.');
      return approvalView(replay);
    }
    const now = Date.now();
    const allowed = await this.repository.consumeApprovalRateLimit({
      actorUserId: input.actorUserId,
      windowStartedAt: new Date(Math.floor(now / 60_000) * 60_000),
      limit: 10,
    });
    if (!allowed)
      throw new HttpException(
        'تعداد تلاش برای اتصال از حد مجاز بیشتر شده است.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const approved = await this.repository.approve({
      pairingCodeHash,
      organizationId: input.organizationId,
      branchId: input.branchId,
      actorUserId: input.actorUserId,
      managementSessionId: input.managementSessionId,
      permissionKeys,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      correlationId: input.correlationId,
      now: new Date(now),
    });
    if (!approved) {
      const concurrentReplay = await this.repository.findByApprovalIdempotencyKey(
        input.idempotencyKey,
      );
      if (concurrentReplay) {
        if (
          concurrentReplay.approvalRequestHash !== requestHash ||
          concurrentReplay.actorUserId !== input.actorUserId
        )
          throw new ConflictException('کلید تکرار برای درخواست دیگری استفاده شده است.');
        return approvalView(concurrentReplay);
      }
      throw new NotFoundException(
        'کد اتصال برای این شعبه معتبر نیست یا اعتبار آن پایان یافته است.',
      );
    }
    return approvalView(approved);
  }

  async inspect(input: { id: string; sourceInstanceId: string; pollSecret: string }) {
    const pairing = await this.requirePairing(input);
    if (pairing.status === 'pending' && pairing.expiresAt.getTime() <= Date.now()) {
      await this.repository.markExpired(pairing.id);
      return { status: 'expired' as const };
    }
    if (pairing.status === 'pending') return { status: 'pending' as const };
    if (pairing.status === 'approved') return { status: 'approved' as const };
    if (pairing.status === 'cancelled') return { status: 'cancelled' as const };
    if (pairing.status === 'expired') return { status: 'expired' as const };
    return { status: 'restart_required' as const };
  }

  async claim(input: { id: string; sourceInstanceId: string; pollSecret: string }) {
    const pairing = await this.requirePairing(input);
    if (pairing.status !== 'approved') return null;
    if (pairing.expiresAt.getTime() <= Date.now()) {
      await this.repository.markExpired(pairing.id);
      return null;
    }
    return this.repository.claim({
      id: pairing.id,
      sourceInstanceId: input.sourceInstanceId,
      now: new Date(),
    });
  }

  async markIssued(input: {
    pairing: EdgeOperatorPairingRecord;
    tokenId: string;
    expiresAt: string;
    correlationId: string;
  }) {
    return this.repository.markIssued({
      id: input.pairing.id,
      tokenId: input.tokenId,
      expiresAt: new Date(input.expiresAt),
      correlationId: input.correlationId,
    });
  }

  async markFailed(id: string) {
    await this.repository.markFailed(id);
  }

  async cancel(input: { id: string; sourceInstanceId: string; pollSecret: string }) {
    const pairing = await this.requirePairing(input);
    if (pairing.status === 'pending' || pairing.status === 'approved') {
      const cancelled = await this.repository.cancel({
        id: pairing.id,
        sourceInstanceId: input.sourceInstanceId,
      });
      if (cancelled) return { status: 'cancelled' as const };
    }
    return this.inspect(input);
  }

  private async requirePairing(input: {
    id: string;
    sourceInstanceId: string;
    pollSecret: string;
  }) {
    if (input.pollSecret.length < 32 || input.pollSecret.length > 128)
      throw new UnauthorizedException('درخواست اتصال مجاز نیست.');
    const pairing = await this.repository.findById(input.id);
    if (!pairing || pairing.sourceInstanceId.toLowerCase() !== input.sourceInstanceId.toLowerCase())
      throw new NotFoundException('درخواست اتصال پیدا نشد.');
    const supplied = Buffer.from(sha256(input.pollSecret), 'hex');
    const stored = Buffer.from(pairing.pollSecretHash, 'hex');
    if (supplied.length !== stored.length || !timingSafeEqual(supplied, stored))
      throw new UnauthorizedException('درخواست اتصال مجاز نیست.');
    return pairing;
  }
}

function normalizeCode(value: string) {
  const code = value.toUpperCase().replace(/[- ]/gu, '');
  return /^[A-HJ-NP-Z2-9]{10}$/u.test(code) ? code : null;
}

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function approvalView(pairing: EdgeOperatorPairingRecord) {
  return {
    status: 'approved' as const,
    branchId: pairing.branchId,
    permissionKeys: pairing.permissionKeys ?? [],
    expiresAt: pairing.expiresAt.toISOString(),
  };
}
