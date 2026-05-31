import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { NotificationsService } from './notifications.service';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

@Controller('notifications')
export class NotificationsController {
  constructor(private notif: NotificationsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query('unreadOnly') unreadOnly?: string) {
    return this.notif.listForUser(u.id, unreadOnly === '1');
  }

  @Get('unread-count')
  count(@CurrentUser() u: AuthUser) {
    return this.notif.unreadCount(u.id);
  }

  @Post(':id/read')
  read(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.notif.markRead(u.id, id);
  }

  @Post('read-all')
  readAll(@CurrentUser() u: AuthUser) {
    return this.notif.markAllRead(u.id);
  }

  /** 手动触发扫描（管理员，便于演示/测试） */
  @Post('scan')
  @Roles(UserRole.ADMIN)
  scan() {
    return this.notif.scan();
  }
}
