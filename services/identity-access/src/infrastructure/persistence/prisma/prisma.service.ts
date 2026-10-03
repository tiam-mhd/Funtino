import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../../../../generated/prisma/index.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({
      datasourceUrl: process.env.IDENTITY_ACCESS_DATABASE_URL,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
