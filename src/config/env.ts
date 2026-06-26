import {z} from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),

})

const _env = envSchema.safeParse(process.env)

if (!_env.success) {
  console.error('Invalid environment variables:', _env.error.format());
  process.exit(1);
}

export const env = _env.data;