import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreatePaymentDto {
  @IsInt() orderId: number;
  @IsNumber() @Min(0) amount: number;
  @IsOptional() @IsString() method?: string;
  @IsOptional() @IsDateString() paidAt?: string;
  @IsOptional() @IsString() remark?: string;
}
