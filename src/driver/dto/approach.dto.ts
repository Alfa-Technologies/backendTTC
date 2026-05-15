import { IsString, IsNotEmpty, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ApproachQueryDto {
  @IsString()
  @IsNotEmpty({ message: 'companyId es requerido' })
  companyId: string;

  @IsString()
  @IsNotEmpty({ message: 'unitId es requerido' })
  unitId: string;

  @Type(() => Number)
  @IsNumber()
  depotId: number;

  @Type(() => Number)
  @IsNumber()
  routeId: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  stopIndex: number;

  @Type(() => Number)
  @IsNumber()
  lat: number;

  @Type(() => Number)
  @IsNumber()
  lng: number;
}
