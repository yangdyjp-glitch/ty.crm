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
import { CommissionStatus, UserRole } from '@prisma/client';
import { CommissionsService } from './commissions.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

@Controller('commissions')
@Roles(UserRole.ADMIN)
export class CommissionsController {
  constructor(private commissions: CommissionsService) {}

  @Get()
  list(
    @Query()
    q: {
      channelId?: string;
      status?: CommissionStatus;
      all?: string;
      page?: string;
      pageSize?: string;
    },
  ) {
    return this.commissions.list(q);
  }

  @Get('cash-accounts')
  cashAccounts(@Query() q: { all?: string; page?: string; pageSize?: string }) {
    return this.commissions.cashAccounts(q);
  }

  @Post('batch-review')
  batchReview(@Body() body: { ids: number[] }) {
    return this.commissions.batchReview(body?.ids || []);
  }

  @Post('batch-pay')
  batchPay(@CurrentUser() user: AuthUser, @Body() body: { ids: number[] }) {
    return this.commissions.batchPay(user, body?.ids || []);
  }

  @Post(':id/review')
  review(@Param('id', ParseIntPipe) id: number) {
    return this.commissions.review(id);
  }

  @Post(':id/pay')
  pay(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { voucherAttachmentId?: number },
  ) {
    return this.commissions.pay(user, id, body?.voucherAttachmentId);
  }

  @Post(':id/pay-installment/:paymentId')
  payInstallment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Param('paymentId', ParseIntPipe) paymentId: number,
    @Body() body: { voucherAttachmentId?: number },
  ) {
    return this.commissions.payInstallment(
      user,
      id,
      paymentId,
      body?.voucherAttachmentId,
    );
  }

  @Post(':id/suspend')
  suspend(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { note?: string },
  ) {
    return this.commissions.suspend(id, body?.note);
  }

  @Post(':id/resume')
  resume(@Param('id', ParseIntPipe) id: number) {
    return this.commissions.resume(id);
  }

  @Post(':id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number) {
    return this.commissions.cancel(id);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.commissions.remove(id);
  }
}
