import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PaymentConfirmStatus, UserRole } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto, UpdatePaymentDto } from './dto/payment.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

@Controller('payments')
@Roles(UserRole.SALES, UserRole.BUSINESS_SUPERVISOR, UserRole.ADMIN)
export class PaymentsController {
  constructor(private payments: PaymentsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() q: { orderId?: string; confirmStatus?: PaymentConfirmStatus },
  ) {
    return this.payments.list(user, q);
  }

  @Get('pending')
  @Roles(UserRole.ADMIN)
  pending() {
    return this.payments.pending();
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePaymentDto) {
    return this.payments.create(user, dto);
  }

  @Post(':id/confirm')
  @Roles(UserRole.ADMIN)
  confirm(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.payments.confirm(user, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePaymentDto,
  ) {
    return this.payments.update(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.payments.remove(user, id);
  }
}
