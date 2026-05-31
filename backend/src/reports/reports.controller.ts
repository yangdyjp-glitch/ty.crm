import { Controller, Get } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ReportsService } from './reports.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

@Controller('reports')
export class ReportsController {
  constructor(private reports: ReportsService) {}

  // 角色感知仪表盘：各角色看各自数据
  @Get('dashboard')
  dashboard(@CurrentUser() user: AuthUser) {
    return this.reports.dashboard(user);
  }

  @Get('finance')
  @Roles(UserRole.ADMIN)
  finance() {
    return this.reports.finance();
  }

  @Get('channels')
  @Roles(UserRole.ADMIN)
  channels() {
    return this.reports.channels();
  }

  @Get('sales')
  @Roles(UserRole.ADMIN)
  sales() {
    return this.reports.sales();
  }
}
