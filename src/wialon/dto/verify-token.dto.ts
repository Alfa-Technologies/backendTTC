import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyTokenDto {
  @IsNotEmpty({ message: 'El token es requerido' })
  @IsString({ message: 'El token debe ser una cadena de texto' })
  token: string;
}
