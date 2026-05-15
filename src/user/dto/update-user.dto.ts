import {
  IsOptional,
  IsArray,
  IsBoolean,
  IsString,
  ValidateNested,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';

class UserPreferencesDto {
  @IsOptional()
  @IsBoolean()
  pushNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  emailNotifications?: boolean;

  @IsOptional()
  @IsBoolean()
  locationServices?: boolean;
}

export class UpdateUserDto {
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  favRoutesIds?: number[];

  @IsOptional()
  @ValidateNested()
  @Type(() => UserPreferencesDto)
  preferences?: UserPreferencesDto;

  @IsOptional()
  @IsString()
  currentRideId?: string;

  @IsOptional()
  @IsString()
  currentUnitId?: string;

  @IsOptional()
  @IsString()
  currentDepotId?: string;

  @IsOptional()
  @IsString()
  deviceToken?: string;

  @IsOptional()
  @IsString()
  appVersion?: string;
}
