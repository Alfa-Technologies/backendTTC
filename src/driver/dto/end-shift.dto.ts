import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class EndShiftDto {
  @IsString()
  @IsNotEmpty({ message: 'El companyId es requerido' })
  companyId: string;

  @IsString()
  @IsNotEmpty({ message: 'El unitId es requerido' })
  unitId: string;

  @IsNotEmpty({ message: 'El rideId es requerido' })
  rideId: string | number;

  @IsOptional()
  depotId?: number | string;
}
