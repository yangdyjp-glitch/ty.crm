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
import { OrderStatus, UserRole } from '@prisma/client';
import { OrdersService } from './orders.service';
import { CreateOrderDto, UpdateOrderDto } from './dto/order.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

@Controller('orders')
@Roles(UserRole.SALES, UserRole.BUSINESS_SUPERVISOR, UserRole.ADMIN)
export class OrdersController {
  constructor(private orders: OrdersService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query()
    q: { customerId?: string; status?: OrderStatus; all?: string; page?: string; pageSize?: string },
  ) {
    return this.orders.list(user, q);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.orders.get(user, id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.orders.create(user, dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateOrderDto,
  ) {
    return this.orders.update(user, id, dto);
  }

  @Post(':id/start-service')
  startService(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.orders.startService(user, id);
  }

  @Post(':id/complete-service')
  completeService(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.orders.completeService(user, id);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.orders.remove(user, id);
  }
}
