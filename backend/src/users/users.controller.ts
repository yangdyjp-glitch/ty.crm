import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

@Controller('users')
export class UsersController {
  constructor(private users: UsersService) {}

  /** 下拉选项：管理员可取任意角色；市场只能取销售（用于线索指派） */
  @Get('options')
  options(@CurrentUser() u: AuthUser, @Query('role') role?: UserRole) {
    if (u.role === UserRole.ADMIN) return this.users.options(role);
    if (u.role === UserRole.MARKET) return this.users.options(UserRole.SALES);
    throw new ForbiddenException('无权访问');
  }

  @Get()
  @Roles(UserRole.ADMIN)
  list(@Query('role') role?: UserRole) {
    return this.users.list(role);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto) {
    return this.users.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.users.remove(u.id, id);
  }
}
