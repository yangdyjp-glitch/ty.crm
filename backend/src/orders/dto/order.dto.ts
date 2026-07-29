import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Currency, FundSettlementMode } from '@prisma/client';

export class CreateOrderDto {
  @IsInt() customerId: number;
  @IsInt() productId: number;
  @IsEnum(Currency) currency: Currency;
  @IsNumber() @Min(0) originalPrice: number;
  @IsOptional() @IsNumber() @Min(0) discountAmount?: number;
  @IsOptional() @IsDateString() signedAt?: string;
  @IsOptional() @IsString() contractNo?: string;
  @IsOptional() @IsEnum(FundSettlementMode) fundSettlementMode?: FundSettlementMode;
  @IsOptional() @IsString() remark?: string;

  // 签约：首款（必填）+ 尾款（选填），各生成一条待确认收款
  @IsNumber() @Min(0) firstPaymentAmount: number;
  @IsOptional() @IsNumber() @Min(0) tailPaymentAmount?: number;
  @IsOptional() @IsString() firstPaymentMethod?: string;
  @IsOptional() @IsDateString() firstPaymentPaidAt?: string;
}

export class UpdateOrderDto {
  @IsOptional() @IsNumber() @Min(0) originalPrice?: number;
  @IsOptional() @IsNumber() @Min(0) discountAmount?: number;
  @IsOptional() @IsString() contractNo?: string;
  @IsOptional() @IsDateString() signedAt?: string;
  @IsOptional() @IsString() remark?: string;
}
