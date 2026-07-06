import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { RefundStatus, UserRole } from '@prisma/client';
import { RefundsService } from './refunds.service';
import { CreateRefundDto } from './dto/refund.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

@Controller('refunds')
@Roles(UserRole.SALES, UserRole.BUSINESS_SUPERVISOR, UserRole.ADMIN)
export class RefundsController {
  constructor(private refunds: RefundsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() q: { orderId?: string; status?: RefundStatus },
  ) {
    return this.refunds.list(user, q);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRefundDto) {
    return this.refunds.create(user, dto);
  }

  @Post(':id/approve')
  @Roles(UserRole.ADMIN)
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.refunds.approve(user, id);
  }

  @Post(':id/pay')
  @Roles(UserRole.ADMIN)
  pay(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.refunds.pay(user, id);
  }

  @Post(':id/reject')
  @Roles(UserRole.ADMIN)
  reject(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.refunds.reject(user, id);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.refunds.remove(user, id);
  }
}
