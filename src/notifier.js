const axios = require('axios');
const config = require('../config');
const logger = require('./logger');

class Notifier {
  constructor() {
    this.webhookUrl = process.env.DISCORD_WEBHOOK_URL || null;
    this.enabled = !!this.webhookUrl;
    if (this.enabled) {
      logger.info('Discord notifications enabled');
    }
  }

  async send(content, embeds = []) {
    if (!this.enabled) return;
    try {
      await axios.post(this.webhookUrl, {
        username: 'SOL Scalper Bot',
        avatar_url: 'https://cryptologos.cc/logos/solana-sol-logo.png',
        content,
        embeds,
      });
    } catch (err) {
      logger.warn('Discord error: ' + err.message);
    }
  }

  async tradeOpened(position) {
    const mode = config.mode === 'paper' ? '📄 PAPER' : '🔴 LIVE';
    await this.send('', [{
      title: `${mode} TRADE OPENED — ${position.symbol}`,
      color: 0x00ff88,
      fields: [
        { name: '💵 Size',        value: `$${position.sizeUSD.toFixed(2)}`,     inline: true },
        { name: '🎯 Entry',       value: `$${position.entryPrice.toFixed(6)}`,  inline: true },
        { name: '🛑 Stop Loss',   value: `$${position.stopLoss.toFixed(6)}`,    inline: true },
        { name: '✅ Take Profit', value: `$${position.takeProfit.toFixed(6)}`,  inline: true },
        { name: '📊 Score',       value: `${position.score}/100`,               inline: true },
        { name: '📋 Reasons',     value: (position.reasons||[]).join(', ')||'—',inline: false},
      ],
      timestamp: new Date().toISOString(),
    }]);
  }

  async tradeClosed(trade) {
    const win = trade.realizedPnL > 0;
    const mode = config.mode === 'paper' ? '📄 PAPER' : '🔴 LIVE';
    await this.send('', [{
      title: `${win ? '✅' : '❌'} ${mode} TRADE CLOSED — ${trade.symbol}`,
      color: win ? 0x00ff88 : 0xff4466,
      fields: [
        { name: '💰 P&L',    value: `$${trade.realizedPnL.toFixed(3)}`, inline: true },
        { name: '📈 %',      value: `${trade.realizedPct.toFixed(2)}%`, inline: true },
        { name: '📋 Reason', value: trade.closeReason || '—',           inline: true },
      ],
      timestamp: new Date().toISOString(),
    }]);
  }

  async alert(message) {
    await this.send('', [{
      title: '⚠️ ALERT',
      description: message,
      color: 0xffd060,
      timestamp: new Date().toISOString(),
    }]);
  }

  async dailySummary(state) {
    const s = state.stats || {};
    const win = state.dailyPnL > 0;
    await this.send('', [{
      title: '📊 Daily Summary',
      color: win ? 0x00ff88 : 0xff4466,
      fields: [
        { name: '💰 Daily P&L',   value: `$${(state.dailyPnL||0).toFixed(3)}`, inline: true },
        { name: '🏦 Balance',     value: `$${(state.balance||0).toFixed(2)}`,   inline: true },
        { name: '🎯 Win Rate',    value: `${(s.winRate||0).toFixed(1)}%`,        inline: true },
        { name: '✅ Wins',        value: `${s.wins||0}`,                         inline: true },
        { name: '❌ Losses',      value: `${s.losses||0}`,                       inline: true },
        { name: '📋 Total Trades',value: `${s.totalTrades||0}`,                 inline: true },
      ],
      timestamp: new Date().toISOString(),
    }]);
  }
}

module.exports = new Notifier();
