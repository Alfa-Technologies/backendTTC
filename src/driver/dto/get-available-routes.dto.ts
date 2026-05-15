import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';

export class GetAvailableRoutesDto {
  @IsString()
  @IsNotEmpty({ message: 'El unitId es requerido' })
  unitId: string;

  @IsString()
  @IsNotEmpty({ message: 'El companyId es requerido' })
  companyId: string;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsBoolean()
  forceRefresh?: boolean;
}
