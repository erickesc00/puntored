import { z } from 'zod';

const toNumber = (defaultValue: number) =>
  z.coerce.number().int().positive().default(defaultValue);

const toBoolean = (defaultValue: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .transform((value) => {
      if (typeof value === 'boolean') {
        return value;
      }

      return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    })
    .default(defaultValue);

export const appEnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: toNumber(3000),
  GLOBAL_PREFIX: z.string().default('api'),
  APP_VERSION: z.string().default('0.1.0'),
  DATABASE_URL: z.string().min(1),
  COOKIE_NAME: z.string().default('puntored.sid'),
  COOKIE_SECRET: z.string().min(16),
  COOKIE_SECURE: toBoolean(false),
  COOKIE_DOMAIN: z.string().optional(),
  SESSION_IDLE_TTL_MINUTES: toNumber(30),
  SESSION_ABSOLUTE_TTL_HOURS: toNumber(8),
  BCRYPT_ROUNDS: toNumber(10),
  LOGIN_RATE_LIMIT_TTL_SECONDS: toNumber(60),
  LOGIN_RATE_LIMIT_LIMIT: toNumber(5),
  PROVIDER_SHARED_SECRET: z
    .string()
    .min(16)
    .default('change-this-provider-secret'),
  PROVIDER_ACTOR_ID: z.string().default('provider:puntored'),
});

export type AppEnv = z.infer<typeof appEnvSchema>;
