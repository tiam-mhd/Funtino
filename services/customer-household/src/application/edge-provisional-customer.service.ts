import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { createEventEnvelope, eventTypes } from '@funtino/event-contracts';
import { Prisma } from '../../generated/prisma/index.js';
import { PrismaService } from '../infrastructure/persistence/prisma/prisma.service.js';

export type ProvisionalCustomerCommand = {
  provisionalId: string;
  sourceInstanceId: string;
  branchId: string;
  actorUserId: string;
  correlationId: string;
  idempotencyKey: string;
};

@Injectable()
export class EdgeProvisionalCustomerService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: ProvisionalCustomerCommand) {
    const requestHash = createHash('sha256')
      .update(
        JSON.stringify({
          provisionalId: input.provisionalId,
          sourceInstanceId: input.sourceInstanceId,
          branchId: input.branchId,
        }),
      )
      .digest('hex');

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const priorCommand = await tx.idempotencyCommand.findUnique({
            where: {
              callerService_key: { callerService: 'device-integration', key: input.idempotencyKey },
            },
          });
          if (priorCommand) {
            if (priorCommand.requestHash !== requestHash) {
              throw new ConflictException('Idempotency key was reused for a different request.');
            }
            return priorCommand.response as unknown as ProvisionalCustomerView;
          }

          const existing = await tx.provisionalCustomer.findUnique({
            where: {
              sourceInstanceId_provisionalId: {
                sourceInstanceId: input.sourceInstanceId,
                provisionalId: input.provisionalId,
              },
            },
          });
          if (existing && existing.branchId !== input.branchId) {
            throw new ConflictException(
              'Provisional customer is already assigned to a different branch.',
            );
          }

          const record =
            existing ??
            (await tx.provisionalCustomer.create({
              data: {
                id: randomUUID(),
                provisionalId: input.provisionalId,
                sourceInstanceId: input.sourceInstanceId,
                branchId: input.branchId,
                createdByUserId: input.actorUserId,
                status: 'pending_review',
              },
            }));
          const response = present(record);
          if (!existing) {
            await tx.auditLog.create({
              data: {
                id: randomUUID(),
                actorUserId: input.actorUserId,
                callerService: 'device-integration',
                action: 'customer.provisional.created',
                resourceType: 'provisional_customer',
                resourceId: record.id,
                correlationId: input.correlationId,
                after: {
                  provisionalId: record.provisionalId,
                  sourceInstanceId: record.sourceInstanceId,
                  branchId: record.branchId,
                  status: record.status,
                },
              },
            });
            const envelope = createEventEnvelope({
              eventType: eventTypes.provisionalCustomerCreated,
              sourceId: 'customer-household',
              aggregateId: record.id,
              correlationId: input.correlationId,
              branchId: record.branchId,
              payload: {
                provisionalId: record.provisionalId,
                sourceInstanceId: record.sourceInstanceId,
                branchId: record.branchId,
                status: 'pending_review',
              },
            });
            await tx.outboxEvent.create({
              data: {
                id: envelope.eventId,
                eventType: envelope.eventType,
                aggregateId: envelope.aggregateId,
                envelope: envelope as unknown as Prisma.InputJsonValue,
              },
            });
          }
          await tx.idempotencyCommand.create({
            data: {
              callerService: 'device-integration',
              key: input.idempotencyKey,
              requestHash,
              response: response as unknown as Prisma.InputJsonValue,
            },
          });
          return response;
        },
        { isolationLevel: 'Serializable', maxWait: 2_000, timeout: 5_000 },
      );
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const replay = await this.prisma.idempotencyCommand.findUnique({
          where: {
            callerService_key: { callerService: 'device-integration', key: input.idempotencyKey },
          },
        });
        if (replay && replay.requestHash === requestHash) {
          return replay.response as unknown as ProvisionalCustomerView;
        }
        throw new ConflictException('Provisional customer request was already recorded.');
      }
      throw new ServiceUnavailableException('Provisional customer could not be recorded.');
    }
  }
}

type ProvisionalCustomerView = {
  provisionalId: string;
  sourceInstanceId: string;
  branchId: string;
  status: 'pending_review' | 'linked' | 'rejected';
  createdAt: string;
};

function present(record: {
  provisionalId: string;
  sourceInstanceId: string;
  branchId: string;
  status: 'pending_review' | 'linked' | 'rejected';
  createdAt: Date;
}): ProvisionalCustomerView {
  return {
    provisionalId: record.provisionalId,
    sourceInstanceId: record.sourceInstanceId,
    branchId: record.branchId,
    status: record.status,
    createdAt: record.createdAt.toISOString(),
  };
}
