import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { PaymentConfirmStatus, UserRole } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/payment.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

@Controller('payments')
@Roles(UserRole.SALES, UserRole.ADMIN)
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
}
