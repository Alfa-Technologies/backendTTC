import { IsString, IsNotEmpty, IsUrl } from 'class-validator';

export class UpdateProfilePhotoDto {
  @IsString()
  @IsNotEmpty({ message: 'El userId es requerido' })
  userId: string;

  @IsString()
  @IsNotEmpty({ message: 'La photoURL es requerida' })
  @IsUrl({}, { message: 'La photoURL debe ser una URL válida' })
  photoURL: string;
}
