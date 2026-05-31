import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { LedgerService } from './ledger.service';
import { Roles } from '../auth/roles.decorator';

@Controller('channels/:channelId/ledger')
@Roles(UserRole.ADMIN)
export class LedgerController {
  constructor(private ledger: LedgerService) {}

  @Get()
  async list(@Param('channelId', ParseIntPipe) channelId: number) {
    const [entries, balances] = await Promise.all([
      this.ledger.list(channelId),
      this.ledger.balances(channelId),
    ]);
    return { entries, balances };
  }
}
