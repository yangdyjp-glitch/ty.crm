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

  // 签约 + 首款同屏（可选）
  @IsOptional() @IsNumber() @Min(0) firstPaymentAmount?: number;
  @IsOptional() @IsString() firstPaymentMethod?: string;
  @IsOptional() @IsDateString() firstPaymentPaidAt?: string;
}

export class UpdateOrderDto {
  @IsOptional() @IsNumber() @Min(0) originalPrice?: number;
  @IsOptional() @IsNumber() @Min(0) discountAmount?: number;
  @IsOptional() @IsString() contractNo?: string;
  @IsOptional() @IsString() remark?: string;
}
