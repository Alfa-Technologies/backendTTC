import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { FirebaseModule } from '../firebase/firebase.module';
import { NimbusService } from './nimbus.service';
import { NimbusController } from './nimbus.controller';

@Module({
  imports: [
    HttpModule.register({
      timeout: 30000,
      maxRedirects: 5,
    }),
    FirebaseModule,
  ],
  controllers: [NimbusController],
  providers: [NimbusService],
})
export class NimbusModule {}
