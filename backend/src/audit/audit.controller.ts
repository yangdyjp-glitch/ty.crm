import { Controller, Get, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuditService } from './audit.service';
import { Roles } from '../auth/roles.decorator';

@Controller('audit-logs')
@Roles(UserRole.ADMIN)
export class AuditController {
  constructor(private audit: AuditService) {}

  @Get()
  list(@Query() q: { relatedType?: string; operatorId?: string }) {
    return this.audit.list(q);
  }
}
