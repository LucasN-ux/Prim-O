import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';
import { config } from './config';
import { UPLOADS_DIR } from './lib/upload';
import { errorHandler } from './middleware/error.middleware';
import authRouter from './routes/auth.routes';
import employeeRouter from './routes/employee.routes';
import attributionRouter from './routes/attribution.routes';
import motifRouter from './routes/motif.routes';
import cookieParser from 'cookie-parser';
import inviteRouter from './routes/invite.routes';
import offerRouter from './routes/offer.routes';
import companyRouter from './routes/company.routes';
import statsRouter from './routes/stats.routes';

import adminRouter from './routes/admin.routes';
import testRouter from './routes/test.routes';
import privacyRouter from './routes/privacy.routes';
import { requireAuth, requireAdmin } from './middleware/auth.middleware';

//stripe
import stripeRouter from './routes/stripe.routes';
import { stripeWebhookController } from './controllers/stripeWebhook.controller';

// The Express app is built here WITHOUT listening on a port: server.ts
// (prod/dev) does the listen + starts the jobs; integration tests
// (Supertest) import the app directly, without a server or port.
const app = express();

// Authenticated dynamic API: no ETag → no 304 (which breaks fetch,
// res.ok becoming false and an empty body on the client side).
app.set('etag', false);

// TWO proxies sit in front of us in production, not one: the Vercel rewrite that forwards
// /api/*, then Render's own proxy. With a value of 1, Express reads the wrong entry of
// X-Forwarded-For and every visitor comes out as the same address, Vercel's egress IP. Every
// rate limiter below then shares a single counter for the whole application: ten logins per
// quarter hour for all users put together, which three people testing a demo exhaust in two
// minutes. Measured: with 1, req.ip is the proxy; with 2, it is the real visitor.
if (config.NODE_ENV === 'production') app.set('trust proxy', 2);

// 1. Security headers
app.use(helmet());
// 2. CORS (before rate limit)
app.use(cors({origin: config.CLIENT_URL, credentials: true}));
// 3. Rate limiting - GLOBAL, broad DoS guard. Sensitive routes
// (login, refresh, code generation) have their own tight budgets
// in lib/rateLimit.ts. This global ceiling must NOT throttle the
// normal traffic of an SPA: each navigation triggers /me + /offers, and a 401
// → refresh → retry triples the calls (×2 again in StrictMode dev).
// Disabled in test: integration suites fire requests back to back.
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => config.NODE_ENV === 'test',
  message: { error: 'Trop de requêtes, réessaie dans 1 minute.' },
}));

// In dev: detailed colored logs
// In prod: short format (saves on logs)
if (config.NODE_ENV !== 'test') {
  app.use(morgan(config.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// Stripe webhook: RAW body required (signature verification) → BEFORE express.json().
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhookController);

// 4. Parse JSON
app.use(express.json());
// Parser cookies
app.use(cookieParser());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', env: config.NODE_ENV });
});

// Uploaded files (offer photos) served statically. Public (landing showcase).
// Under /api/uploads to go through the Vite proxy in dev (which only routes /api).
app.use('/api/uploads', express.static(UPLOADS_DIR));

app.use('/api/auth', authRouter);
app.use('/api/me', privacyRouter);
app.use('/api/employees', employeeRouter);
app.use('/api/attributions', attributionRouter);
app.use('/api/motifs', motifRouter);
app.use('/api/invites', inviteRouter);
app.use('/api/company', companyRouter);
app.use('/api/offers', offerRouter);
app.use('/api/stats', statsRouter);
app.use('/api/admin', requireAuth, requireAdmin, adminRouter);

//Stripe endpoints
app.use('/api/stripe', stripeRouter);

// Test routes (email self-verification for integration tests): NEVER in production.
if (config.NODE_ENV !== 'production') {
  app.use('/api/test', testRouter);
}

app.use(errorHandler);

export default app;
