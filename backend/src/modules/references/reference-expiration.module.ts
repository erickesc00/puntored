import { Module } from '@nestjs/common';
import { AppConfigService } from '../../common/config/app-config.service';
import { ReferenceExpirationRepository } from './reference-expiration.repository';
import { ReferenceExpirationService } from './reference-expiration.service';

@Module({
  providers: [
    AppConfigService,
    ReferenceExpirationRepository,
    ReferenceExpirationService,
  ],
  exports: [ReferenceExpirationService],
})
export class ReferenceExpirationModule {}
