import { IsString, IsNotEmpty, IsUrl } from 'class-validator';

export class UpdateCompanyLogoDto {
  @IsString()
  @IsNotEmpty({ message: 'El companyId es requerido' })
  companyId: string;

  @IsString()
  @IsNotEmpty({ message: 'La logoURL es requerida' })
  @IsUrl({}, { message: 'La logoURL debe ser una URL válida' })
  logoURL: string;
}
