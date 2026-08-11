import Fastify from 'fastify';
import {
  createProviderReferenceRepository,
  type ProviderReferenceRepository,
} from './db/sqlite';
import { registerExternalReferenceRoutes } from './routes/external-references';

export interface ProviderStubEnv {
  port: number;
  host: string;
  databasePath: string;
  apiKey: string;
  backendCreateUrl: string;
  backendCallbackUrl: string;
  providerSharedSecret: string;
}

export interface BuildProviderStubAppOptions {
  env?: ProviderStubEnv;
  repository?: ProviderReferenceRepository;
  fetchImpl?: typeof fetch;
}

export function readProviderStubEnv(
  source: NodeJS.ProcessEnv = process.env,
): ProviderStubEnv {
  return {
    port: Number(source.PORT ?? '3002'),
    host: source.HOST ?? '0.0.0.0',
    databasePath: source.STUB_DB_PATH ?? './data/stub.db',
    apiKey: source.STUB_API_KEY ?? 'change-this-stub-api-key',
    backendCreateUrl:
      source.BACKEND_CREATE_URL ?? 'http://localhost:3000/api/provider/references',
    backendCallbackUrl:
      source.BACKEND_CALLBACK_URL ?? 'http://localhost:3000/api/provider/events',
    providerSharedSecret:
      source.PROVIDER_SHARED_SECRET ?? 'change-this-provider-secret',
  };
}

export async function buildProviderStubApp(
  options: BuildProviderStubAppOptions = {},
) {
  const env = options.env ?? readProviderStubEnv();
  const repository =
    options.repository ?? createProviderReferenceRepository(env.databasePath);

  const app = Fastify({ logger: true });

  app.get('/health', async () => ({ status: 'ok' }));

  await registerExternalReferenceRoutes(app, {
    apiKey: env.apiKey,
    backendCreateUrl: env.backendCreateUrl,
    backendCallbackUrl: env.backendCallbackUrl,
    providerSharedSecret: env.providerSharedSecret,
    repository,
    fetchImpl: options.fetchImpl,
  });

  app.addHook('onClose', async () => {
    repository.close();
  });

  return app;
}

async function start() {
  const env = readProviderStubEnv();
  const app = await buildProviderStubApp({ env });

  await app.listen({ port: env.port, host: env.host });
}

if (require.main === module) {
  start().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
