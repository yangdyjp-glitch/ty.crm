import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsArray,
  ArrayUnique,
  ArrayMaxSize,
  Min,
  MaxLength,
} from 'class-validator';
import {
  CustomerMainStatus,
  FollowMethod,
  IntentionLevel,
  SalesStage,
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
  @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(20) @IsInt({ each: true }) @Min(1, { each: true }) salesUserIds?: number[];
  @IsOptional() @IsEnum(IntentionLevel) intentionLevel?: IntentionLevel;
  @IsOptional() @IsString() remark?: string;
  @IsOptional() @IsDateString() discoveredAt?: string;

  /** 兼容旧客户端；不能绕过查重，另建档案必须提供 distinctReason。 */
  @IsOptional() @IsBoolean() force?: boolean;
  @IsOptional() @IsString() @MaxLength(500) distinctReason?: string;
}

export class CustomerVersionDto {
  @IsDateString() expectedUpdatedAt: string;
}

export class CustomerIdentityDto {
  @IsString() @MaxLength(100) name: string;
  @IsEnum(SourceCategory) sourceCategory: SourceCategory;
  @IsOptional() @IsInt() @Min(1) channelId?: number;
  @IsOptional() @IsInt() @Min(1) acquisitionChannelId?: number;
}

export class UpdateCustomerDto extends CustomerVersionDto {
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
  @IsOptional() @IsEnum(CustomerMainStatus) mainStatus?: CustomerMainStatus;
  @IsOptional() @IsEnum(SourceCategory) sourceCategory?: SourceCategory;
  @IsOptional() @IsInt() channelId?: number;
  @IsOptional() @IsInt() acquisitionChannelId?: number;
  @IsOptional() @IsString() remark?: string;
  @IsOptional() @IsDateString() discoveredAt?: string;
}

export class AssignDto extends CustomerVersionDto {
  @IsArray() @ArrayUnique() @ArrayMaxSize(20) @IsInt({ each: true }) @Min(1, { each: true }) salesUserIds: number[];
}

export class AssignDownstreamDto {
  @IsInt() downstreamSalesUserId: number;
}

export class FollowUpDto extends CustomerVersionDto {
  @IsEnum(FollowMethod) method: FollowMethod;
  @IsString() content: string;
  @IsOptional() @IsString() customerFeedback?: string;
  @IsOptional() @IsString() result?: string;
  @IsOptional() @IsDateString() nextFollowUpAt?: string;
  @IsOptional() @IsDateString() followedAt?: string;
}

export class SetProblemDto extends CustomerVersionDto {
  @IsBoolean() hasProblem: boolean;
  @IsOptional() @IsString() problemNote?: string;
  @IsOptional() @IsInt() problemHandlerId?: number;
}

export class SetStatusDto extends CustomerVersionDto {
  @IsEnum(CustomerMainStatus) mainStatus: CustomerMainStatus;
}

export class SetSalesStageDto extends CustomerVersionDto {
  @IsEnum(SalesStage) salesStage: SalesStage;
}
