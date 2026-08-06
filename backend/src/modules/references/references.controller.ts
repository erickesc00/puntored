import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { SessionAuth } from '../auth/guards/session.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { SessionGuard } from '../auth/guards/session.guard';
import { CancelReferenceDto } from './dto/cancel-reference.dto';
import { CreateReferenceDto } from './dto/create-reference.dto';
import { ListReferencesDto } from './dto/list-references.dto';
import { ReferencesService } from './references.service';

@Controller('references')
@UseGuards(SessionGuard, RoleGuard)
export class ReferencesController {
  constructor(private readonly referencesService: ReferencesService) {}

  @Post()
  @Roles(UserRole.OPERATOR, UserRole.SUPERVISOR)
  createReference(
    @CurrentUser() actor: SessionAuth,
    @Body() body: CreateReferenceDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
  ) {
    return this.referencesService.createReference(
      actor,
      body,
      idempotencyKey,
      request.correlationId,
    );
  }

  @Get()
  @Roles(UserRole.OPERATOR, UserRole.SUPERVISOR)
  listReferences(@Query() query: ListReferencesDto) {
    return this.referencesService.listReferences(query);
  }

  @Get(':id')
  @Roles(UserRole.OPERATOR, UserRole.SUPERVISOR)
  getReferenceDetail(@Param('id') id: string) {
    return this.referencesService.getReferenceDetail(id);
  }

  @Post(':id/cancel')
  @Roles(UserRole.SUPERVISOR)
  cancelReference(
    @Param('id') id: string,
    @Body() body: CancelReferenceDto,
    @CurrentUser() actor: SessionAuth,
    @Req() request: Request,
  ) {
    return this.referencesService.cancelReference(
      id,
      body,
      actor,
      request.correlationId,
    );
  }
}
