require('dotenv').config();

const config = {
  mode: process.env.TRADING_MODE || 'paper',
  port: parseInt(process.env.PORT) || 3000,

  solana: {
    rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    privateKey: process.env.WALLET_PRIVATE_KEY || null,
  },

  paper: {
    startingBalance: parseFloat(process.env.PAPER_STARTING_BALANCE) || 1000,
  },

  risk: {
    maxPositionSizeUSD: parseFloat(process.env.MAX_POSITION_SIZE_USD) || 50,
    stopLossPercent: parseFloat(process.env.STOP_LOSS_PERCENT) || 2.5,
    takeProfitPercent: parseFloat(process.env.TAKE_PROFIT_PERCENT) || 3.0,
    maxSlippageBps: parseInt(process.env.MAX_SLIPPAGE_BPS) || 150,
    maxDailyLossUSD: parseFloat(process.env.MAX_DAILY_LOSS_USD) || 100,
    maxConcurrentPositions: parseInt(process.env.MAX_CONCURRENT_POSITIONS) || 3,
  },

  scanner: {
    intervalSeconds: parseInt(process.env.SCAN_INTERVAL_SECONDS) || 15,
    minLiquidityUSD: parseFloat(process.env.MIN_LIQUIDITY_USD) || 150000,
    minVolume24h: parseFloat(process.env.MIN_VOLUME_24H_USD) || 50000,
    minBuyPressurePercent: parseFloat(process.env.MIN_BUY_PRESSURE_PERCENT) || 60,
    watchList: process.env.WATCH_LIST
      ? process.env.WATCH_LIST.split(',').map(s => s.trim()).filter(Boolean)
      : [],
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || null,
    chatId: process.env.TELEGRAM_CHAT_ID || null,
  },

  logLevel: process.env.LOG_LEVEL || 'info',
};

if (config.mode === 'live' && !config.solana.privateKey) {
  console.error('LIVE MODE requires WALLET_PRIVATE_KEY in .env');
  process.exit(1);
}

module.exports = config;
