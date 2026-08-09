import { Module } from '@nestjs/common';
import { MetricsModule } from '../../common/metrics/metrics.module';
import { AuthModule } from '../auth/auth.module';
import { ProviderAllocationClient } from './provider-client';
import { ReferencesController } from './references.controller';
import { ReferencesService } from './references.service';

@Module({
  imports: [AuthModule, MetricsModule],
  controllers: [ReferencesController],
  providers: [ReferencesService, ProviderAllocationClient],
})
export class ReferencesModule {}
