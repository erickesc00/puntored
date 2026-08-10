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
import {
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ReferenceResponseDto } from './dto/reference-response.dto';
import { ListReferencesResponseDto } from './dto/list-references-response.dto';
import { ReferenceDetailResponseDto } from './dto/reference-detail-response.dto';

@Controller('references')
@UseGuards(SessionGuard, RoleGuard)
@ApiTags('references')
@ApiCookieAuth('sessionCookie')
export class ReferencesController {
  constructor(private readonly referencesService: ReferencesService) {}

  @Post()
  @Roles(UserRole.OPERATOR, UserRole.SUPERVISOR)
  @ApiOperation({ summary: 'Create a payment reference' })
  @ApiHeader({ name: 'idempotency-key', required: true })
  @ApiCreatedResponse({ type: ReferenceResponseDto })
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
  @ApiOperation({ summary: 'List payment references' })
  @ApiOkResponse({ type: ListReferencesResponseDto })
  listReferences(@Query() query: ListReferencesDto) {
    return this.referencesService.listReferences(query);
  }

  @Get(':id')
  @Roles(UserRole.OPERATOR, UserRole.SUPERVISOR)
  @ApiOperation({ summary: 'Get a payment reference detail' })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: ReferenceDetailResponseDto })
  getReferenceDetail(@Param('id') id: string) {
    return this.referencesService.getReferenceDetail(id);
  }

  @Post(':id/cancel')
  @Roles(UserRole.SUPERVISOR)
  @ApiOperation({ summary: 'Cancel a payment reference' })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ type: ReferenceResponseDto })
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
