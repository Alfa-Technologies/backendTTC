import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  HttpException,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { DriverService, ApproachPayload } from './driver.service';
import { GetAvailableRoutesDto } from './dto/get-available-routes.dto';
import { StartShiftDto } from './dto/start-shift.dto';
import { EndShiftDto } from './dto/end-shift.dto';
import { ApproachQueryDto } from './dto/approach.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { UpdateProfilePhotoDto } from './dto/update-profile-photo.dto';
import { UpdateCompanyLogoDto } from './dto/update-company-logo.dto';
import { CheckInPassengerDto } from './dto/check-in-passenger.dto';
import { ScanPassengerDto } from './dto/scan-passenger.dto';

@Controller('api/driver')
export class DriverController {
  constructor(private readonly driverService: DriverService) {}

  @Post('available-routes')
  @HttpCode(200)
  async getAvailableRoutes(@Body() dto: GetAvailableRoutesDto) {
    try {
      const routes = await this.driverService.getAvailableRoutes(dto);
      return {
        success: true,
        data: routes,
        count: routes.length,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error obteniendo rutas disponibles',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('start-shift')
  @HttpCode(200)
  async startShift(@Body() dto: StartShiftDto) {
    try {
      const result = await this.driverService.startShift(dto);
      return result;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error al iniciar el turno',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('end-shift')
  @HttpCode(200)
  async endShift(@Body() dto: EndShiftDto) {
    try {
      const result = await this.driverService.endShift(dto);
      return result;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error al finalizar el turno',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('shift/:rideId/approach')
  async getApproach(
    @Param('rideId') rideId: string,
    @Query() query: ApproachQueryDto,
  ) {
    try {
      return await this.driverService.getApproach(rideId, query);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error calculando aproximación',
        },
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  @Get('unit-location/:unitId')
  async getUnitLocation(@Param('unitId') unitId: string) {
    try {
      return await this.driverService.getUnitLocation(unitId);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error obteniendo ubicación de la unidad',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('location')
  @HttpCode(200)
  async updateLocation(@Body() payload: UpdateLocationDto) {
    try {
      return await this.driverService.updateLocation(payload);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error actualizando ubicación',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('update-profile-photo')
  @HttpCode(200)
  async updateProfilePhoto(@Body() dto: UpdateProfilePhotoDto) {
    try {
      return await this.driverService.updateProfilePhoto(dto);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error actualizando foto de perfil',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('update-company-logo')
  @HttpCode(200)
  async updateCompanyLogo(@Body() dto: UpdateCompanyLogoDto) {
    try {
      return await this.driverService.updateCompanyLogo(dto);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error actualizando logo de empresa',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('check-in-passenger')
  @HttpCode(200)
  async checkInPassenger(@Body() dto: CheckInPassengerDto) {
    try {
      return await this.driverService.checkInPassenger(dto);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error registrando pasajero',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Post('scan-passenger')
  @HttpCode(200)
  async scanPassenger(@Body() dto: ScanPassengerDto) {
    try {
      return await this.driverService.scanPassenger(dto);
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        {
          success: false,
          message: error.message || 'Error escaneando pasajero',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
