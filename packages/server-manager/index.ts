import type { Server } from 'http';
import { Logger } from '@tron0/shared/Logger';
import app, { stopEviction } from './main';

const logger = new Logger('ServerManager');

const rawPort = process.env.PORT || process.env.MANAGER_PORT || '3001';
const HOST = process.env.HOST || '0.0.0.0';

if (!/^\d+$/.test(rawPort)) {
  logger.error(
    `Invalid port configuration: PORT=${process.env.PORT ?? ''} MANAGER_PORT=${process.env.MANAGER_PORT ?? ''}`,
  );
  process.exit(1);
}

const PORT = Number(rawPort);
if (!Number.isInteger(PORT) || PORT <= 0) {
  logger.error(
    `Invalid port configuration: PORT=${process.env.PORT ?? ''} MANAGER_PORT=${process.env.MANAGER_PORT ?? ''}`,
  );
  process.exit(1);
}

const SHUTDOWN_TIMEOUT_MS = 9_000;
let isShuttingDown = false;

function shutdown(signal: string): void {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`${signal} received, draining connections…`);
  stopEviction();

  const forceExit = setTimeout(() => {
    logger.warn('Forced shutdown after grace period');
    const httpServer = server as Server & { closeAllConnections?: () => void };
    httpServer.closeAllConnections?.();
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  server.close((err) => {
    clearTimeout(forceExit);
    if (err) {
      logger.error('Error during shutdown', err);
      process.exit(1);
    }
    logger.info('Shutdown complete');
    process.exit(0);
  });
}

const server = app.listen(PORT, HOST, () => {
  logger.info(`Listening on ${HOST}:${PORT}`);
});

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));