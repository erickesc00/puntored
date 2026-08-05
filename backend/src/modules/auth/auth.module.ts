import { Module } from '@nestjs/common';
import { AppConfigService } from '../../common/config/app-config.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RoleGuard } from './guards/role.guard';
import { SessionGuard } from './guards/session.guard';

@Module({
  controllers: [AuthController],
  providers: [AppConfigService, AuthService, SessionGuard, RoleGuard],
  exports: [AppConfigService, AuthService, SessionGuard, RoleGuard],
})
export class AuthModule {}
