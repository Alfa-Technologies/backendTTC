import { Controller, Get, Post, Patch, Delete, Query, Param, Body } from '@nestjs/common';
import { NimbusService } from './nimbus.service';
import { GetStopDetailsDto } from './dto/get-stop-details.dto';
import { GetRouteByIdDto } from './dto/get-route-by-id.dto';
import { CreateRouteDto } from './dto/create-route.dto';
import { UpdateRouteDto } from './dto/update-route.dto';
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

  @Post('depot/:depotId/routes')
  async createRoute(
    @CurrentUser() user: any,
    @Param('depotId') depotId: string,
    @Body() dto: CreateRouteDto,
  ) {
    return this.nimbusService.createRoute(user.uid, Number(depotId), dto);
  }

  @Patch('routes/:routeId')
  async updateRoute(
    @CurrentUser() user: any,
    @Param('routeId') routeId: string,
    @Body() dto: UpdateRouteDto,
  ) {
    return this.nimbusService.updateRoute(user.uid, Number(routeId), dto);
  }

  @Delete('routes/:routeId')
  async deleteRoute(
    @CurrentUser() user: any,
    @Param('routeId') routeId: string,
  ) {
    return this.nimbusService.deleteRoute(user.uid, Number(routeId));
  }
}
