import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AppConfigService } from '../../../common/config/app-config.service';
import { ERROR_CODE } from '../../../shared/vocabulary/error-codes';

@Injectable()
export class ProviderAuthGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const sharedSecretHeader = request.header('x-provider-secret')?.trim();

    if (
      !sharedSecretHeader ||
      sharedSecretHeader !== this.config.provider.sharedSecret
    ) {
      throw new UnauthorizedException({
        code: ERROR_CODE.PROVIDER_UNAUTHORIZED,
        message: 'Provider authentication failed',
      });
    }

    return true;
  }
}
