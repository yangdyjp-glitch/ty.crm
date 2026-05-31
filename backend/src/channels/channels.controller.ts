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
import { ChannelType, UserRole } from '@prisma/client';
import { ChannelsService } from './channels.service';
import {
  CreateAcquisitionChannelDto,
  CreateChannelDto,
  UpdateChannelDto,
} from './dto/channel.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

@Controller('channels')
@Roles(UserRole.ADMIN, UserRole.MARKET)
export class ChannelsController {
  constructor(private channels: ChannelsService) {}

  @Get()
  list(@Query('type') type?: ChannelType) {
    return this.channels.list(type);
  }

  @Get('options')
  options() {
    return this.channels.options();
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.channels.get(id);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Body() dto: CreateChannelDto) {
    // 市场仅可即时创建“个人第三方”渠道；企业渠道由管理员维护
    if (u.role === UserRole.MARKET && dto.channelType !== ChannelType.INDIVIDUAL) {
      throw new ForbiddenException('市场仅可创建个人第三方渠道');
    }
    return this.channels.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateChannelDto) {
    return this.channels.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.channels.remove(id);
  }
}
