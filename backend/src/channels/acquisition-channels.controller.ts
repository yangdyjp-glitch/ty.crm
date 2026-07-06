import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { ChannelsService } from './channels.service';
import {
  CreateAcquisitionChannelDto,
  UpdateAcquisitionChannelDto,
} from './dto/channel.dto';
import { Roles } from '../auth/roles.decorator';

@Controller('acquisition-channels')
@Roles(UserRole.ADMIN, UserRole.MARKET, UserRole.BUSINESS_SUPERVISOR)
export class AcquisitionChannelsController {
  constructor(private channels: ChannelsService) {}

  @Get()
  list() {
    return this.channels.listAcquisition();
  }

  @Get('all')
  listAll() {
    return this.channels.listAcquisitionAll();
  }

  @Post()
  create(@Body() dto: CreateAcquisitionChannelDto) {
    return this.channels.createAcquisition(dto.name);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAcquisitionChannelDto,
  ) {
    return this.channels.updateAcquisition(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.channels.removeAcquisition(id);
  }
}
