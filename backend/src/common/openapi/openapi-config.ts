import { DocumentBuilder, type OpenAPIObject } from '@nestjs/swagger';
import type { INestApplication } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';
import { AppConfigService } from '../config/app-config.service';

export function buildOpenApiConfig(config: AppConfigService) {
  return new DocumentBuilder()
    .setTitle('Puntored Backend API')
    .setDescription(
      'HTTP API for authentication, references, health, and provider events.',
    )
    .setVersion(config.version)
    .addServer(`/${config.http.globalPrefix}`, 'Configured API prefix')
    .addApiKey(
      { type: 'apiKey', in: 'cookie', name: config.session.cookieName },
      'sessionCookie',
    )
    .addApiKey(
      { type: 'apiKey', in: 'header', name: 'x-provider-secret' },
      'providerApiKey',
    )
    .build();
}

export function createOpenApiDocument(
  app: INestApplication,
  config: AppConfigService,
): OpenAPIObject {
  return SwaggerModule.createDocument(app, buildOpenApiConfig(config), {
    ignoreGlobalPrefix: true,
  });
}

export function setupOpenApi(
  app: INestApplication,
  config: AppConfigService,
): OpenAPIObject {
  const document = createOpenApiDocument(app, config);
  SwaggerModule.setup('docs', app, document, { useGlobalPrefix: true });
  return document;
}
