import { Controller, Get, Query } from '@nestjs/common';
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
  finance(
    @Query()
    q: { period?: 'all' | 'year' | 'month'; year?: string; month?: string },
  ) {
    return this.reports.finance(q);
  }

  @Get('channels')
  @Roles(UserRole.ADMIN)
  channels(
    @Query()
    q: { period?: 'all' | 'year' | 'month'; year?: string; month?: string },
  ) {
    return this.reports.channels(q);
  }

  @Get('sales')
  @Roles(UserRole.ADMIN)
  sales(
    @Query()
    q: { period?: 'all' | 'year' | 'month'; year?: string; month?: string },
  ) {
    return this.reports.sales(q);
  }

  @Get('funnel')
  @Roles(UserRole.ADMIN)
  funnel() {
    return this.reports.funnel();
  }
}
