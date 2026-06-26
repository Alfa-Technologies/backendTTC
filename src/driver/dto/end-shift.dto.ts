import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class EndShiftDto {
  @IsString()
  @IsNotEmpty({ message: 'El shiftId es requerido' })
  shiftId: string;

  @IsOptional()
  @IsString()
  driverId?: string;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsString()
  unitId?: string;

  @IsOptional()
  rideId?: string | number;

  @IsOptional()
  depotId?: number | string;
}
