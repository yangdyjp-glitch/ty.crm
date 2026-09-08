import { Module } from '@nestjs/common';
import { ChannelsService } from './channels.service';
import { ChannelsController } from './channels.controller';
import { AcquisitionChannelsController } from './acquisition-channels.controller';
import { CommissionsModule } from '../commissions/commissions.module';

@Module({
  imports: [CommissionsModule],
  providers: [ChannelsService],
  controllers: [ChannelsController, AcquisitionChannelsController],
  exports: [ChannelsService],
})
export class ChannelsModule {}
