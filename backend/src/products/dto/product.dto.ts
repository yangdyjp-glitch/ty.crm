import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { Currency } from '@prisma/client';

export class CreateProductDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsNumber()
  @Min(0)
  standardPrice: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @IsEnum(Currency)
  currency: Currency;

  @IsOptional()
  @IsBoolean()
  allowDiscount?: boolean;

  @IsOptional()
  @IsBoolean()
  participateCommission?: boolean;

  @IsOptional()
  @IsInt()
  servicePeriodDays?: number;

  @IsOptional()
  @IsString()
  remark?: string;
}

export class UpdateProductDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsNumber() @Min(0) standardPrice?: number;
  @IsOptional() @IsNumber() @Min(0) minPrice?: number;
  @IsOptional() @IsEnum(Currency) currency?: Currency;
  @IsOptional() @IsBoolean() allowDiscount?: boolean;
  @IsOptional() @IsBoolean() participateCommission?: boolean;
  @IsOptional() @IsInt() servicePeriodDays?: number;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() remark?: string;
}
