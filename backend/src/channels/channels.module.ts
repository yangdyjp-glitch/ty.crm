import { Module } from '@nestjs/common';
import { ChannelsService } from './channels.service';
import { ChannelsController } from './channels.controller';
import { AcquisitionChannelsController } from './acquisition-channels.controller';

@Module({
  providers: [ChannelsService],
  controllers: [ChannelsController, AcquisitionChannelsController],
  exports: [ChannelsService],
})
export class ChannelsModule {}
