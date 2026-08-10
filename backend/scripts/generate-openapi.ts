import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { AppConfigService } from '../src/common/config/app-config.service';
import { createOpenApiDocument } from '../src/common/openapi/openapi-config';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { stringify } from 'yaml';

async function generateOpenApi() {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(PrismaService)
    .useValue({})
    .compile();

  const app = moduleRef.createNestApplication();
  const config = app.get(AppConfigService);
  app.setGlobalPrefix(config.http.globalPrefix);
  await app.init();

  try {
    const document = createOpenApiDocument(app, config);
    await writeFile(
      path.resolve(__dirname, '..', 'openapi.yaml'),
      stringify(document),
      'utf8',
    );
  } finally {
    await app.close();
  }
}

void generateOpenApi();
