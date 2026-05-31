import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ReferralCollectionStatus, UserRole } from '@prisma/client';
import { ReferralsService } from './referrals.service';
import {
  CollectDto,
  CreateReferralDto,
  UpdateReferralDto,
} from './dto/referral.dto';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser, AuthUser } from '../auth/current-user.decorator';

@Controller('referrals')
@Roles(UserRole.DOWNSTREAM_SALES, UserRole.ADMIN)
export class ReferralsController {
  constructor(private referrals: ReferralsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query()
    q: { collectionStatus?: ReferralCollectionStatus; customerId?: string },
  ) {
    return this.referrals.list(user, q);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateReferralDto) {
    return this.referrals.create(user, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateReferralDto,
  ) {
    return this.referrals.update(user, id, dto);
  }

  @Post(':id/collect')
  collect(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CollectDto,
  ) {
    return this.referrals.collect(user, id, dto);
  }

  @Post(':id/uncollect')
  uncollect(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.referrals.uncollect(user, id);
  }
}
