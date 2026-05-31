import { Body, Controller, Get, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ChannelsService } from './channels.service';
import { CreateAcquisitionChannelDto } from './dto/channel.dto';
import { Roles } from '../auth/roles.decorator';

@Controller('acquisition-channels')
@Roles(UserRole.ADMIN, UserRole.MARKET)
export class AcquisitionChannelsController {
  constructor(private channels: ChannelsService) {}

  @Get()
  list() {
    return this.channels.listAcquisition();
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.MARKET)
  create(@Body() dto: CreateAcquisitionChannelDto) {
    return this.channels.createAcquisition(dto.name);
  }
}
