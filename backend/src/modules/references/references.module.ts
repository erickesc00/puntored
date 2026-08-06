import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReferencesController } from './references.controller';
import { ReferencesService } from './references.service';

@Module({
  imports: [AuthModule],
  controllers: [ReferencesController],
  providers: [ReferencesService],
})
export class ReferencesModule {}
