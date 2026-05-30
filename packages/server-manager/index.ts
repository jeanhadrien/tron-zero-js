import { Logger } from '@tron0/shared/Logger';
import app from './main';

const logger = new Logger('ServerManager');

const PORT = parseInt(process.env.MANAGER_PORT || process.env.PORT || '3001', 10);

app.listen(PORT, () => {
  logger.info(`Listening on port ${PORT}`);
});
