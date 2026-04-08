import { IsNotEmpty, IsString } from 'class-validator';

export class GetRouteByIdDto {
  @IsNotEmpty({ message: 'El depotId es requerido' })
  @IsString({ message: 'El depotId debe ser una cadena de texto' })
  depotId: string;
}
