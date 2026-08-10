import { Module } from '@nestjs/common';
import { AppConfigService } from '../../common/config/app-config.service';
import { MetricsModule } from '../../common/metrics/metrics.module';
import { ReferenceExpirationService } from './reference-expiration.service';
import { ReferencesModule } from './references.module';

@Module({
  imports: [MetricsModule, ReferencesModule],
  providers: [AppConfigService, ReferenceExpirationService],
  exports: [ReferenceExpirationService],
})
export class ReferenceExpirationModule {}
