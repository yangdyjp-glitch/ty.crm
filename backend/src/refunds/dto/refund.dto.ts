import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { RefundBearer, RefundReason } from '@prisma/client';

export class CreateRefundDto {
  @IsInt() orderId: number;

  /** 退款比例（基于合同），0–1，与 nominalAmount 二选一 */
  @IsOptional() @IsNumber() @Min(0) @Max(1) refundRatio?: number;

  /** 名义退款额，与 refundRatio 二选一 */
  @IsOptional() @IsNumber() @Min(0) nominalAmount?: number;

  @IsEnum(RefundReason) reason: RefundReason;
  @IsOptional() @IsString() reasonNote?: string;

  /** 退款承担方：公司 / 第三方（第三方垫付时入往来台账） */
  @IsOptional() @IsEnum(RefundBearer) bearer?: RefundBearer;

  @IsOptional() @IsDateString() appliedAt?: string;
}
