const config = require('../config');
const logger = require('./logger');

class PaperTradingEngine {
  constructor() {
    this.balance = config.paper.startingBalance;
    this.startingBalance = config.paper.startingBalance;
    this.positions = new Map();
    this.closedTrades = [];
    this.dailyPnL = 0;
    this.totalPnL = 0;
    this.stats = {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalFeesPaid: 0,
      largestWin: 0,
      largestLoss: 0,
    };
    logger.info(`Paper Trading started — Balance: $${this.balance}`);
  }

  _calculateFee(amountUSD) {
    return amountUSD * 0.0025 + 0.002;
  }

  _applySlippage(price, isBuy) {
    const slip = (config.risk.maxSlippageBps / 10000) * 0.5;
    return isBuy ? price * (1 + slip) : price * (1 - slip);
  }

  canTrade() {
    if (this.dailyPnL <= -config.risk.maxDailyLossUSD) {
      return { allowed: false, reason: 'Daily loss limit reached' };
    }
    if (this.positions.size >= config.risk.maxConcurrentPositions) {
      return { allowed: false, reason: 'Max positions reached' };
    }
    if (this.balance < config.risk.maxPositionSizeUSD) {
      return { allowed: false, reason: 'Insufficient balance' };
    }
    return { allowed: true };
  }

  openPosition(opportunity) {
    const check = this.canTrade();
    if (!check.allowed) {
      logger.info(`Trade skipped: ${check.reason}`);
      return null;
    }
    if (this.positions.has(opportunity.pairAddress)) return null;

    const sizeUSD = Math.min(config.risk.maxPositionSizeUSD, this.balance * 0.95);
    const entryPrice = this._applySlippage(opportunity.priceUsd, true);
    const fee = this._calculateFee(sizeUSD);
    const tokenAmount = sizeUSD / entryPrice;

    this.balance -= (sizeUSD + fee);
    this.stats.totalFeesPaid += fee;

    const position = {
      id: `PAPER-${Date.now()}`,
      pairAddress: opportunity.pairAddress,
      symbol: opportunity.baseToken.symbol,
      entryPrice,
      currentPrice: entryPrice,
      tokenAmount,
      sizeUSD,
      fee,
      stopLoss: entryPrice * (1 - config.risk.stopLossPercent / 100),
      takeProfit: entryPrice * (1 + config.risk.takeProfitPercent / 100),
      pnlUSD: -fee,
      pnlPercent: 0,
      openedAt: new Date().toISOString(),
      score: opportunity.score,
      reasons: opportunity.reasons,
      dexId: opportunity.dexId,
    };

    this.positions.set(opportunity.pairAddress, position);
    logger.info(`PAPER OPEN: ${position.symbol} | $${sizeUSD.toFixed(2)} | Entry $${entryPrice.toFixed(6)}`);
    return position;
  }

  updatePosition(pairAddress, currentPrice) {
    const pos = this.positions.get(pairAddress);
    if (!pos) return null;

    pos.currentPrice = currentPrice;
    const currentValue = pos.tokenAmount * currentPrice;
    pos.pnlUSD = currentValue - pos.sizeUSD - pos.fee;
    pos.pnlPercent = (pos.pnlUSD / pos.sizeUSD) * 100;

    if (currentPrice <= pos.stopLoss) {
      logger.warn(`STOP LOSS: ${pos.symbol}`);
      return this.closePosition(pairAddress, currentPrice, 'stop_loss');
    }
    if (currentPrice >= pos.takeProfit) {
      logger.info(`TAKE PROFIT: ${pos.symbol}`);
      return this.closePosition(pairAddress, currentPrice, 'take_profit');
    }
    return pos;
  }

  closePosition(pairAddress, currentPrice, reason = 'manual') {
    const pos = this.positions.get(pairAddress);
    if (!pos) return null;

    const exitPrice = this._applySlippage(currentPrice, false);
    const exitFee = this._calculateFee(pos.tokenAmount * exitPrice);
    const exitValue = pos.tokenAmount * exitPrice;
    const realizedPnL = exitValue - pos.sizeUSD - pos.fee - exitFee;
    const realizedPct = (realizedPnL / pos.sizeUSD) * 100;

    this.balance += exitValue - exitFee;
    this.dailyPnL += realizedPnL;
    this.totalPnL += realizedPnL;
    this.stats.totalFeesPaid += exitFee;
    this.stats.totalTrades++;

    if (realizedPnL > 0) {
      this.stats.wins++;
      this.stats.largestWin = Math.max(this.stats.largestWin, realizedPnL);
    } else {
      this.stats.losses++;
      this.stats.largestLoss = Math.min(this.stats.largestLoss, realizedPnL);
    }

    this.stats.winRate = (this.stats.wins / this.stats.totalTrades) * 100;

    const closed = {
      ...pos,
      exitPrice,
      realizedPnL,
      realizedPct,
      closeReason: reason,
      closedAt: new Date().toISOString(),
    };

    this.closedTrades.unshift(closed);
    if (this.closedTrades.length > 100) this.closedTrades.pop();
    this.positions.delete(pairAddress);

    const emoji = realizedPnL > 0 ? 'WIN' : 'LOSS';
    logger.info(`PAPER CLOSE [${emoji}]: ${pos.symbol} | PnL $${realizedPnL.toFixed(3)} (${realizedPct.toFixed(2)}%) | Balance $${this.balance.toFixed(2)}`);
    return closed;
  }

  getState() {
    return {
      mode: 'paper',
      balance: parseFloat(this.balance.toFixed(4)),
      startingBalance: this.startingBalance,
      totalPnL: parseFloat(this.totalPnL.toFixed(4)),
      totalPnLPercent: parseFloat(((this.totalPnL / this.startingBalance) * 100).toFixed(2)),
      dailyPnL: parseFloat(this.dailyPnL.toFixed(4)),
      openPositions: Array.from(this.positions.values()),
      closedTrades: this.closedTrades.slice(0, 20),
      stats: {
        ...this.stats,
        winRate: parseFloat(this.stats.winRate.toFixed(1)),
      },
    };
  }
}

module.exports = PaperTradingEngine;
