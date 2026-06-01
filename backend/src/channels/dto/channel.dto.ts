import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import {
  ChannelType,
  CommissionMethod,
  CooperationStatus,
  FundSettlementMode,
  SettlementCondition,
} from '@prisma/client';

export class CreateChannelDto {
  @IsString()
  name: string;

  @IsEnum(ChannelType)
  channelType: ChannelType;

  @IsOptional() @IsString() contactName?: string;
  @IsOptional() @IsString() contactInfo?: string;
  @IsOptional() @IsNumber() defaultCommissionRate?: number;
  @IsOptional() @IsEnum(CommissionMethod) commissionMethod?: CommissionMethod;
  @IsOptional() @IsEnum(FundSettlementMode) fundSettlementMode?: FundSettlementMode;
  @IsOptional() @IsEnum(SettlementCondition) settlementCondition?: SettlementCondition;
  @IsOptional() @IsEnum(CooperationStatus) cooperationStatus?: CooperationStatus;
  @IsOptional() @IsString() remark?: string;
}

export class UpdateChannelDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsEnum(ChannelType) channelType?: ChannelType;
  @IsOptional() @IsString() contactName?: string;
  @IsOptional() @IsString() contactInfo?: string;
  @IsOptional() @IsNumber() defaultCommissionRate?: number;
  @IsOptional() @IsEnum(CommissionMethod) commissionMethod?: CommissionMethod;
  @IsOptional() @IsEnum(FundSettlementMode) fundSettlementMode?: FundSettlementMode;
  @IsOptional() @IsEnum(SettlementCondition) settlementCondition?: SettlementCondition;
  @IsOptional() @IsEnum(CooperationStatus) cooperationStatus?: CooperationStatus;
  @IsOptional() @IsString() remark?: string;
}

export class CreateAcquisitionChannelDto {
  @IsString()
  name: string;
}

export class UpdateAcquisitionChannelDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
