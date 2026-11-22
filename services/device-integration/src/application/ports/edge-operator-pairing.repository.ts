export type EdgeOperatorPairingStatus =
  | 'pending'
  | 'approved'
  | 'claimed'
  | 'issued'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type EdgeOperatorPairingRecord = {
  id: string;
  sourceInstanceId: string;
  organizationId: string;
  branchId: string;
  pairingCodeHash: string;
  pollSecretHash: string;
  status: EdgeOperatorPairingStatus;
  expiresAt: Date;
  actorUserId: string | null;
  managementSessionId: string | null;
  permissionKeys: string[] | null;
  approvalIdempotencyKey: string | null;
  approvalRequestHash: string | null;
};

export const EDGE_OPERATOR_PAIRING_REPOSITORY = Symbol('EDGE_OPERATOR_PAIRING_REPOSITORY');

export interface EdgeOperatorPairingRepository {
  createPending(input: {
    id: string;
    sourceInstanceId: string;
    organizationId: string;
    branchId: string;
    pairingCodeHash: string;
    pollSecretHash: string;
    expiresAt: Date;
  }): Promise<void>;
  findById(id: string): Promise<EdgeOperatorPairingRecord | null>;
  findByApprovalIdempotencyKey(key: string): Promise<EdgeOperatorPairingRecord | null>;
  consumeApprovalRateLimit(input: {
    actorUserId: string;
    windowStartedAt: Date;
    limit: number;
  }): Promise<boolean>;
  approve(input: {
    pairingCodeHash: string;
    organizationId: string;
    branchId: string;
    actorUserId: string;
    managementSessionId: string;
    permissionKeys: string[];
    idempotencyKey: string;
    requestHash: string;
    correlationId: string;
    now: Date;
  }): Promise<EdgeOperatorPairingRecord | null>;
  claim(input: {
    id: string;
    sourceInstanceId: string;
    now: Date;
  }): Promise<EdgeOperatorPairingRecord | null>;
  markIssued(input: {
    id: string;
    tokenId: string;
    expiresAt: Date;
    correlationId: string;
  }): Promise<boolean>;
  markFailed(id: string): Promise<void>;
  markExpired(id: string): Promise<void>;
  cancel(input: { id: string; sourceInstanceId: string }): Promise<boolean>;
}
