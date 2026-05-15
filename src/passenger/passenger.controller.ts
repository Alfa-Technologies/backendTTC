import { Controller, Get, Param, Query } from '@nestjs/common';
import { PassengerService } from './passenger.service';
import { ActiveTripQueryDto } from './dto/active-trip-query.dto';
import { CurrentUser } from '../firebase/decorators/current-user.decorator';

@Controller('api/passenger')
export class PassengerController {
  constructor(private readonly passengerService: PassengerService) {}

  @Get('active-trip/:routeId')
  async getActiveTrip(
    @Param('routeId') routeId: string,
    @Query() query: ActiveTripQueryDto,
    @CurrentUser() user: any,
  ) {
    return this.passengerService.getActiveTrip(user.uid, routeId, query);
  }
}
