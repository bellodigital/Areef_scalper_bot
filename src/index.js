require('dotenv').config();
const config = require('../config');
const logger = require('./logger');
const ScalpingBot = require('./bot');
const createServer = require('./server');

async function main() {
  logger.info('===============================');
  logger.info('   SOLANA DEX SCALPER v1.0.0');
  logger.info(`   Mode : ${config.mode.toUpperCase()}`);
  logger.info(`   Port : ${config.port}`);
  logger.info('===============================');

  const bot = new ScalpingBot();
  const app = createServer(bot);

  app.listen(config.port, () => {
    logger.info(`Dashboard → http://localhost:${config.port}`);
  });

  await bot.start();

  process.on('SIGTERM', () => {
    bot.stop();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    bot.stop();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
