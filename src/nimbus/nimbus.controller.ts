import { Controller, Get, Query, Param } from '@nestjs/common';
import { NimbusService } from './nimbus.service';
import { GetStopDetailsDto } from './dto/get-stop-details.dto';
import { GetRouteByIdDto } from './dto/get-route-by-id.dto';
import { CurrentUser } from '../firebase/decorators/current-user.decorator';

@Controller('api/nimbus')
export class NimbusController {
  constructor(private readonly nimbusService: NimbusService) {}

  @Get('stop')
  async getStopDetails(
    @CurrentUser() user: any,
    @Query() dto: GetStopDetailsDto,
  ) {
    return this.nimbusService.getStopDetails(user.uid, dto.depotId, dto.stopId);
  }

  @Get('groups')
  async getGroups(@CurrentUser() user: any) {
    return this.nimbusService.getGroups(user.uid);
  }

  @Get('routes')
  async getRoutes(@CurrentUser() user: any) {
    return this.nimbusService.getRoutes(user.uid);
  }

  @Get('routes/:routeId')
  async getRouteById(
    @CurrentUser() user: any,
    @Param('routeId') routeId: string,
    @Query() dto: GetRouteByIdDto,
  ) {
    return this.nimbusService.getRouteById(user.uid, routeId, dto.depotId);
  }

  @Get('unit/:unitId/location')
  async getUnitLocation(
    @CurrentUser() user: any,
    @Param('unitId') unitId: string,
  ) {
    return this.nimbusService.getUnitLocation(user.uid, unitId);
  }
}
