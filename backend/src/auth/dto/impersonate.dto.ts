import { Type } from 'class-transformer';
import { IsInt } from 'class-validator';

export class ImpersonateDto {
  @Type(() => Number)
  @IsInt()
  userId: number;
}
