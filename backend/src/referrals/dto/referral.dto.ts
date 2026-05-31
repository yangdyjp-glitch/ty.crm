import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Currency } from '@prisma/client';

export class CreateReferralDto {
  @IsInt() customerId: number;
  @IsString() serviceType: string; // 住房/电话卡/保险/其他
  @IsString() downstreamCompany: string;
  @IsNumber() @Min(0) commissionAmount: number;
  @IsEnum(Currency) currency: Currency;
  @IsOptional() @IsDateString() settlementDate?: string;
  @IsOptional() @IsInt() downstreamSalesUserId?: number; // 管理员可指定
  @IsOptional() @IsString() remark?: string;
}

export class UpdateReferralDto {
  @IsOptional() @IsString() serviceType?: string;
  @IsOptional() @IsString() downstreamCompany?: string;
  @IsOptional() @IsNumber() @Min(0) commissionAmount?: number;
  @IsOptional() @IsEnum(Currency) currency?: Currency;
  @IsOptional() @IsDateString() settlementDate?: string;
  @IsOptional() @IsString() remark?: string;
}

export class CollectDto {
  @IsOptional() @IsDateString() collectedAt?: string;
}
