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

    // Candle confirmation tracker
    // { pairAddress: { count: N, opportunity: {...} } }
    this.watchList = new Map();
    this.CONFIRMATIONS_REQUIRED = 3;

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

      // Get current opportunity addresses
      const currentAddresses = new Set(
        opportunities.map(o => o.pairAddress)
      );

      // Remove tokens from watchlist that no longer qualify
      for (const [addr] of this.watchList) {
        if (!currentAddresses.has(addr)) {
          const w = this.watchList.get(addr);
          logger.info(
            `WATCH REMOVED: ${w.opportunity.baseToken.symbol} — lost signal`
          );
          this.watchList.delete(addr);
        }
      }

      // Process top opportunities
      for (const opp of opportunities.slice(0, 5)) {

        // Skip if already in an open position
        if (this.engine.positions.has(opp.pairAddress)) continue;

        // Only watch strong signals
        if (opp.score < 65) continue;

        if (this.watchList.has(opp.pairAddress)) {
          // Token already being watched — increment confirmation count
          const watch = this.watchList.get(opp.pairAddress);
          watch.count += 1;
          watch.opportunity = opp; // Update with latest data

          logger.info(
            `WATCHING: ${opp.baseToken.symbol} — ` +
            `confirmation ${watch.count}/${this.CONFIRMATIONS_REQUIRED} ` +
            `(score: ${opp.score})`
          );

          // Enter on 3rd confirmation
          if (watch.count >= this.CONFIRMATIONS_REQUIRED) {
            logger.info(
              `✅ 3 CANDLES CONFIRMED: ${opp.baseToken.symbol} — ENTERING`
            );
            const position = this.engine.openPosition(opp);
            if (position) {
              await notifier.tradeOpened(position);
            }
            // Remove from watchlist after entry
            this.watchList.delete(opp.pairAddress);
          }

        } else {
          // First time seeing this token qualify — start watching
          this.watchList.set(opp.pairAddress, {
            count: 1,
            opportunity: opp,
            firstSeen: new Date().toISOString(),
          });
          logger.info(
            `👀 WATCHING NEW: ${opp.baseToken.symbol} — ` +
            `confirmation 1/${this.CONFIRMATIONS_REQUIRED} ` +
            `(score: ${opp.score})`
          );
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

        const result = this.engine.updatePosition(
          pos.pairAddress,
          latest.priceUsd
        );

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
      watching: Array.from(this.watchList.values()).map(w => ({
        symbol: w.opportunity.baseToken.symbol,
        score: w.opportunity.score,
        confirmations: w.count,
        required: this.CONFIRMATIONS_REQUIRED,
        firstSeen: w.firstSeen,
      })),
      ...engineState,
      config: {
        scanIntervalSeconds: config.scanner.intervalSeconds,
        maxPositionSize: config.risk.maxPositionSizeUSD,
        stopLoss: config.risk.stopLossPercent,
        takeProfit: config.risk.takeProfitPercent,
        maxPositions: config.risk.maxConcurrentPositions,
        confirmationsRequired: this.CONFIRMATIONS_REQUIRED,
      },
    };
  }
}

module.exports = ScalpingBot;
