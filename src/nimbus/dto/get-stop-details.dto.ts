import { IsNotEmpty, IsString } from 'class-validator';

export class GetStopDetailsDto {
  @IsNotEmpty({ message: 'El depotId es requerido' })
  @IsString({ message: 'El depotId debe ser una cadena de texto' })
  depotId: string;

  @IsNotEmpty({ message: 'El stopId es requerido' })
  @IsString({ message: 'El stopId debe ser una cadena de texto' })
  stopId: string;
}
