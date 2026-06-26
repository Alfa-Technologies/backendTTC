import { IsOptional, IsString } from 'class-validator';

export class UpdateRouteDto {
  @IsOptional()
  @IsString({ message: 'El nombre (n) debe ser texto' })
  n?: string;

  @IsOptional()
  @IsString({ message: 'La descripción (d) debe ser texto' })
  d?: string;
}
