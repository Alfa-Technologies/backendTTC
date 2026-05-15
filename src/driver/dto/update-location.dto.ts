import { IsString, IsNumber, IsOptional } from 'class-validator';

export class UpdateLocationDto {
  @IsString()
  unitId: string;

  @IsOptional()
  rideId?: string | number;

  @IsNumber()
  latitude: number;

  @IsNumber()
  longitude: number;

  @IsOptional()
  @IsNumber()
  course?: number;

  @IsOptional()
  @IsNumber()
  speed?: number;

  @IsOptional()
  @IsNumber()
  accuracy?: number;

  @IsOptional()
  @IsNumber()
  stopIndex?: number;

  @IsOptional()
  @IsNumber()
  routeId?: number;

  @IsOptional()
  @IsNumber()
  depotId?: number;

  @IsOptional()
  @IsString()
  companyId?: string;

  @IsOptional()
  @IsNumber()
  timestamp?: number;
}
