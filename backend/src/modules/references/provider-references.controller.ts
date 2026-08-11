import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ProviderAuthGuard } from '../provider-events/guards/provider-auth.guard';
import { ProviderCreateReferenceDto } from './dto/provider-create-reference.dto';
import { ProviderReferenceResponseDto } from './dto/provider-reference-response.dto';
import { ReferencesService } from './references.service';

@Controller('provider/references')
@UseGuards(ProviderAuthGuard)
@ApiTags('provider-references')
@ApiSecurity('providerApiKey')
export class ProviderReferencesController {
  constructor(private readonly referencesService: ReferencesService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a provider-originated payment reference' })
  @ApiHeader({ name: 'x-provider-secret', required: true })
  @ApiCreatedResponse({ type: ProviderReferenceResponseDto })
  @ApiOkResponse({ type: ProviderReferenceResponseDto })
  async createProviderReference(
    @Body() body: ProviderCreateReferenceDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.referencesService.createProviderReference(
      body,
      request.correlationId,
    );
    response.status(result.statusCode);
    return result.body;
  }
}
