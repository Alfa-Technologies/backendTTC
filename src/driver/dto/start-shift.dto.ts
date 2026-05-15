import { IsString, IsNotEmpty, IsNumber } from 'class-validator';

export class StartShiftDto {
  @IsString()
  @IsNotEmpty({ message: 'El companyId es requerido' })
  companyId: string;

  @IsString()
  @IsNotEmpty({ message: 'El unitId es requerido' })
  unitId: string;

  @IsNumber()
  @IsNotEmpty({ message: 'El depotId es requerido' })
  depotId: number;

  @IsNotEmpty({ message: 'El rideId es requerido' })
  rideId: string | number;

  @IsNumber()
  @IsNotEmpty({ message: 'El routeId es requerido' })
  routeId: number;
}
