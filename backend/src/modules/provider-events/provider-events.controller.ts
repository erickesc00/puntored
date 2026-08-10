import {
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ProviderCallbackDto } from './dto/provider-callback.dto';
import { ProviderAuthGuard } from './guards/provider-auth.guard';
import { ProviderEventsService } from './provider-events.service';
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ProviderEventResponseDto } from './dto/provider-event-response.dto';

@Controller('provider/events')
@UseGuards(ProviderAuthGuard)
@ApiTags('provider-events')
@ApiSecurity('providerApiKey')
export class ProviderEventsController {
  constructor(private readonly providerEventsService: ProviderEventsService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Ingest a provider event' })
  @ApiHeader({ name: 'x-provider-secret', required: true })
  @ApiOkResponse({ type: ProviderEventResponseDto })
  ingestProviderEvent(
    @Body() body: ProviderCallbackDto,
    @Req() request: Request,
  ) {
    return this.providerEventsService.processProviderEvent(
      body,
      request.correlationId,
    );
  }
}
