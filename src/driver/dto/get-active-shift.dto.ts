import { IsString, IsNotEmpty } from 'class-validator';

export class GetActiveShiftDto {
  @IsString()
  @IsNotEmpty({ message: 'El driverId es requerido' })
  driverId: string;
}
