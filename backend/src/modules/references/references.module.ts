import { Module } from '@nestjs/common';
import { MetricsModule } from '../../common/metrics/metrics.module';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthModule } from '../auth/auth.module';
import { AppConfigService } from '../../common/config/app-config.service';
import { ProviderAuthGuard } from '../provider-events/guards/provider-auth.guard';
import { CreateReferenceUseCase } from './application/use-cases/create-reference.use-case';
import { CreateProviderReferenceUseCase } from './application/use-cases/create-provider-reference.use-case';
import { CancelReferenceUseCase } from './application/use-cases/cancel-reference.use-case';
import { GetReferenceDetailUseCase } from './application/use-cases/get-reference-detail.use-case';
import { ListReferencesUseCase } from './application/use-cases/list-references.use-case';
import { REFERENCE_METRICS_PORT } from './application/ports/metrics.port';
import { REFERENCE_PROVIDER_ALLOCATION_PORT } from './application/ports/provider-allocation.port';
import { REFERENCE_REPOSITORY } from './application/ports/reference.repository';
import { REFERENCES_TRANSITION_PORT } from './application/ports/references-transition.port';
import { ProviderAllocationAdapter } from './infrastructure/adapters/provider-allocation.adapter';
import { PrismaReferencesTransitionAdapter } from './infrastructure/adapters/prisma-references-transition.adapter';
import { ReferenceMetricsAdapter } from './infrastructure/adapters/reference-metrics.adapter';
import { PrismaReferenceRepository } from './infrastructure/persistence/prisma-reference.repository';
import { ProviderAllocationClient } from './provider-client';
import { ProviderReferencesController } from './provider-references.controller';
import { ReferencesController } from './references.controller';
import { ReferencesService } from './references.service';

@Module({
  imports: [AuthModule, MetricsModule],
  controllers: [ReferencesController, ProviderReferencesController],
  providers: [
    PrismaService,
    AppConfigService,
    ReferencesService,
    ProviderAllocationClient,
    CreateReferenceUseCase,
    CreateProviderReferenceUseCase,
    CancelReferenceUseCase,
    ListReferencesUseCase,
    GetReferenceDetailUseCase,
    PrismaReferenceRepository,
    ProviderAuthGuard,
    ProviderAllocationAdapter,
    PrismaReferencesTransitionAdapter,
    ReferenceMetricsAdapter,
    {
      provide: REFERENCE_REPOSITORY,
      useExisting: PrismaReferenceRepository,
    },
    {
      provide: REFERENCE_PROVIDER_ALLOCATION_PORT,
      useExisting: ProviderAllocationAdapter,
    },
    {
      provide: REFERENCE_METRICS_PORT,
      useExisting: ReferenceMetricsAdapter,
    },
    {
      provide: REFERENCES_TRANSITION_PORT,
      useExisting: PrismaReferencesTransitionAdapter,
    },
  ],
  exports: [REFERENCE_REPOSITORY, REFERENCES_TRANSITION_PORT],
})
export class ReferencesModule {}
