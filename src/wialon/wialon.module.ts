import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { WialonService } from './wialon.service';
import { WialonController } from './wialon.controller';
import { FirebaseModule } from '../firebase/firebase.module';

@Module({
  imports: [HttpModule, FirebaseModule],
  controllers: [WialonController],
  providers: [WialonService],
})
export class WialonModule {}
