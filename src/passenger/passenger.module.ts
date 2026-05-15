import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { PassengerController } from './passenger.controller';
import { PassengerService } from './passenger.service';
import { FirebaseModule } from '../firebase/firebase.module';
import { DriverModule } from '../driver/driver.module';
import { NimbusModule } from '../nimbus/nimbus.module';

@Module({
  imports: [HttpModule, FirebaseModule, DriverModule, NimbusModule],
  controllers: [PassengerController],
  providers: [PassengerService],
})
export class PassengerModule {}
