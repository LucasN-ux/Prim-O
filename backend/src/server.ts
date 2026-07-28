import 'dotenv/config';
import app from './app';
import { config } from './config';
import { startTokenCleanup } from './jobs/tokenCleanup';
import { startInactiveAccountCleanup } from './jobs/inactiveAccountCleanup';
import { prisma } from './lib/db';

// Global handlers for unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Runtime entry point only: listen + background jobs.
// The app construction (middlewares, routes) lives in app.ts,
// importable by integration tests without opening a port.
const server = app.listen(config.PORT, () => {
  console.log(`Serveur lancé sur http://localhost:${config.PORT}`);
});

// Graceful shutdown on SIGTERM
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(async () => {
    console.log('HTTP server closed');
    await prisma.$disconnect();
    process.exit(0);
  });
  // Force shutdown after 30 seconds
  setTimeout(() => {
    console.error('Forced shutdown after 30s');
    process.exit(1);
  }, 30_000);
});

// Start the job that cleans up revoked tokens (every 24 hours).
startTokenCleanup();

// Start the GDPR anonymization job for inactive accounts (every 24h).
startInactiveAccountCleanup();
