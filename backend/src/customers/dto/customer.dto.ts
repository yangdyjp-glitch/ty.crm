import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
} from 'class-validator';
import {
  CustomerMainStatus,
  FollowMethod,
  IntentionLevel,
  SourceCategory,
} from '@prisma/client';

export class CreateCustomerDto {
  @IsString() name: string;
  @IsOptional() @IsString() nickname?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() wechat?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() countryRegion?: string;
  @IsOptional() @IsString() educationLevel?: string;
  @IsOptional() @IsString() targetStage?: string;
  @IsOptional() @IsString() targetStartTime?: string;

  @IsEnum(SourceCategory) sourceCategory: SourceCategory;
  @IsOptional() @IsInt() acquisitionChannelId?: number;
  @IsOptional() @IsInt() channelId?: number;

  @IsOptional() @IsInt() ownerUserId?: number;
  @IsOptional() @IsEnum(IntentionLevel) intentionLevel?: IntentionLevel;
  @IsOptional() @IsString() remark?: string;
  @IsOptional() @IsDateString() discoveredAt?: string;

  /** 确认疑似重复后强制创建 */
  @IsOptional() @IsBoolean() force?: boolean;
}

export class UpdateCustomerDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() nickname?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() wechat?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() countryRegion?: string;
  @IsOptional() @IsString() educationLevel?: string;
  @IsOptional() @IsString() targetStage?: string;
  @IsOptional() @IsString() targetStartTime?: string;
  @IsOptional() @IsEnum(IntentionLevel) intentionLevel?: IntentionLevel;
  @IsOptional() @IsString() remark?: string;
}

export class AssignDto {
  @IsInt() ownerUserId: number;
}

export class AssignDownstreamDto {
  @IsInt() downstreamSalesUserId: number;
}

export class FollowUpDto {
  @IsEnum(FollowMethod) method: FollowMethod;
  @IsString() content: string;
  @IsOptional() @IsString() customerFeedback?: string;
  @IsOptional() @IsString() result?: string;
  @IsOptional() @IsDateString() nextFollowUpAt?: string;
  @IsOptional() @IsDateString() followedAt?: string;
}

export class SetProblemDto {
  @IsBoolean() hasProblem: boolean;
  @IsOptional() @IsString() problemNote?: string;
  @IsOptional() @IsInt() problemHandlerId?: number;
}

export class SetStatusDto {
  @IsEnum(CustomerMainStatus) mainStatus: CustomerMainStatus;
}
