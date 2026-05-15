import { IsOptional, IsString, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class ActiveTripQueryDto {
  @IsOptional()
  @IsString()
  targetStopId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  depotId?: number;
}
