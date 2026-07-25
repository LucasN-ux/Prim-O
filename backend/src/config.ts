import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.string().default('4000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // .url() is not decoration: a blank box in a hosting dashboard produces an empty string,
  // which .default() does NOT replace, and z.string() would happily accept. The links built
  // from it would then be relative, so broken in a way nobody notices.
  CLIENT_URL: z.string().url().default('http://localhost:5180'),
  // Public backend URL, used to build the email verification link.
  API_URL: z.string().url().default('http://localhost:4000'),
  DATABASE_URL: z.string(),
  JWT_SECRET: z.string().min(32),
  STRIPE_SECRET_KEY: z.string().startsWith('sk_'),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith('whsec_'),
  TOKEN_PRICE_CENTS: z.coerce.number().int().positive().default(100),

  // Brevo (transactional email). Without BREVO_API_KEY, dev mode logs the link to the console
  // instead of sending.
  BREVO_API_KEY: z.string().optional(),
  BREVO_SENDER_EMAIL: z.string().email().default('noreply@primo.local'),
  BREVO_SENDER_NAME: z.string().default("Prim'O"),
})
  // Forgetting one of these in the hosting dashboard used to be silent: the localhost
  // default applied, the service passed its health check, and two user journeys were dead.
  // The password reset was the worst of them, since the link mailed to the user is built
  // from CLIENT_URL, so it pointed at the user's own machine with no way back.
  // Failing the boot is loud, and a deploy that does not start gets noticed immediately.
  .refine(
    (c) =>
      c.NODE_ENV !== 'production' ||
      (!c.CLIENT_URL.includes('localhost') && !c.API_URL.includes('localhost')),
    { message: 'CLIENT_URL et API_URL doivent être renseignées en production.' },
  );

export const config = envSchema.parse(process.env);
