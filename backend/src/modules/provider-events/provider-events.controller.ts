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

@Controller('provider/events')
@UseGuards(ProviderAuthGuard)
export class ProviderEventsController {
  constructor(private readonly providerEventsService: ProviderEventsService) {}

  @Post()
  @HttpCode(200)
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
