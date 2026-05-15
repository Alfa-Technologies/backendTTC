import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CheckInPassengerDto {
  @IsString()
  @IsNotEmpty({ message: 'El passengerId es requerido' })
  passengerId: string;

  @IsString()
  @IsNotEmpty({ message: 'El rideId es requerido' })
  rideId: string;

  @IsString()
  @IsNotEmpty({ message: 'El unitId es requerido' })
  unitId: string;

  @IsString()
  @IsNotEmpty({ message: 'El companyId es requerido' })
  companyId: string;

  @IsOptional()
  @IsString()
  routeId?: string;

  @IsOptional()
  @IsString()
  stopId?: string;
}
