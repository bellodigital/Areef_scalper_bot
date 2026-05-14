const config = require('../config');
const logger = require('./logger');
const scanner = require('./scanner');
const notifier = require('./notifier');
const PaperTradingEngine = require('./paperTrading');

class ScalpingBot {
  constructor() {
    this.running = false;
    this.scanInterval = null;
    this.priceUpdateInterval = null;
    this.lastOpportunities = [];

    if (config.mode === 'paper') {
      this.engine = new PaperTradingEngine();
      logger.info('Bot running in PAPER mode');
    } else {
      const LiveTradingEngine = require('./liveTrading');
      this.engine = new LiveTradingEngine();
      logger.warn('Bot running in LIVE mode — REAL MONEY');
    }
  }

  async start() {
    this.running = true;
    logger.info('Scalping bot started');

    await this.runScanCycle();

    this.scanInterval = setInterval(async () => {
      if (this.running) await this.runScanCycle();
    }, config.scanner.intervalSeconds * 1000);

    this.priceUpdateInterval = setInterval(async () => {
      if (this.running) await this.updateOpenPositions();
    }, 5000);

    logger.info(`Scanning every ${config.scanner.intervalSeconds}s`);
  }

  stop() {
    this.running = false;
    if (this.scanInterval) clearInterval(this.scanInterval);
    if (this.priceUpdateInterval) clearInterval(this.priceUpdateInterval);
    logger.info('Bot stopped');
  }

  async runScanCycle() {
    try {
      const opportunities = await scanner.scan();
      this.lastOpportunities = opportunities;

      for (const opp of opportunities.slice(0, 3)) {
        if (this.engine.positions.has(opp.pairAddress)) continue;

        if (opp.score >= 65) {
          logger.info(`Entry signal: ${opp.baseToken.symbol} (score: ${opp.score})`);
          const position = this.engine.openPosition(opp);
          if (position) {
            await notifier.tradeOpened(position);
          }
        }
      }
    } catch (err) {
      logger.error('Scan cycle error: ' + err.message);
    }
  }

  async updateOpenPositions() {
    try {
      const openPositions = Array.from(this.engine.positions.values());
      if (openPositions.length === 0) return;

      for (const pos of openPositions) {
        const latest = this.lastOpportunities.find(
          o => o.pairAddress === pos.pairAddress
        );
        if (!latest) continue;

        const result = this.engine.updatePosition(pos.pairAddress, latest.priceUsd);

        if (!result && this.engine.closedTrades[0]) {
          await notifier.tradeClosed(this.engine.closedTrades[0]);
        }
      }
    } catch (err) {
      logger.error('Position update error: ' + err.message);
    }
  }

  getStatus() {
    const engineState = this.engine.getState();
    return {
      running: this.running,
      mode: config.mode,
      lastScanAt: scanner.lastScan,
      opportunities: this.lastOpportunities.slice(0, 5),
      ...engineState,
      config: {
        scanIntervalSeconds: config.scanner.intervalSeconds,
        maxPositionSize: config.risk.maxPositionSizeUSD,
        stopLoss: config.risk.stopLossPercent,
        takeProfit: config.risk.takeProfitPercent,
        maxPositions: config.risk.maxConcurrentPositions,
      },
    };
  }
}

module.exports = ScalpingBot;
