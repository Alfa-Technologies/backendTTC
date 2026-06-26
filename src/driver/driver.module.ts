import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DriverController } from './driver.controller';
import { DriverService } from './driver.service';
import { FirebaseModule } from '../firebase/firebase.module';
import { NimbusModule } from '../nimbus/nimbus.module';
import { PushModule } from '../push/push.module';

@Module({
  imports: [HttpModule, FirebaseModule, NimbusModule, PushModule],
  controllers: [DriverController],
  providers: [DriverService],
  exports: [DriverService],
})
export class DriverModule {}
