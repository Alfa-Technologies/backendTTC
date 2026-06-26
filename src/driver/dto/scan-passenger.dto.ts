import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumber,
  IsDateString,
  Allow,
} from 'class-validator';

export class ScanPassengerDto {
  @IsString()
  @IsNotEmpty({ message: 'El companyId es requerido' })
  companyId: string;

  @IsString()
  @IsNotEmpty({ message: 'El passengerId es requerido' })
  passengerId: string;

  @IsString()
  @IsNotEmpty({ message: 'El qr es requerido' })
  qr: string;

  @IsString()
  @IsNotEmpty({ message: 'El rideId es requerido' })
  rideId: string;

  @IsOptional()
  @IsString()
  shiftId?: string;

  @IsOptional()
  @IsString()
  passengerName?: string;

  @IsOptional()
  @IsDateString()
  scannedAt?: string;

  @IsOptional()
  @IsNumber()
  stopIndex?: number;

  @IsOptional()
  @IsString()
  stopName?: string;

  @IsString()
  @IsNotEmpty({ message: 'El unitId es requerido' })
  unitId: string;

  @IsOptional()
  @IsNumber()
  lat?: number;

  @IsOptional()
  @IsNumber()
  lng?: number;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;
}
