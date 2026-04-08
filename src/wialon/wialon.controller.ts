import { Controller, Get, Post, Body } from '@nestjs/common';
import { WialonService } from './wialon.service';
import { VerifyTokenDto } from './dto/verify-token.dto';
import { CurrentUser } from '../firebase/decorators/current-user.decorator';

@Controller('api/wialon')
export class WialonController {
  constructor(private readonly wialonService: WialonService) {}

  @Post('verify-token')
  async verifyToken(@Body() dto: VerifyTokenDto) {
    return this.wialonService.verifyToken(dto.token);
  }

  @Get('units')
  async getUnits(@CurrentUser() user: any) {
    return this.wialonService.getUnits(user.uid);
  }
}
