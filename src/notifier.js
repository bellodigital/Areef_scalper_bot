const axios = require('axios');
const config = require('../config');
const logger = require('./logger');

class Notifier {
  constructor() {
    this.enabled = !!(config.telegram.botToken && config.telegram.chatId);
    if (this.enabled) {
      logger.info('Telegram notifications enabled');
    }
  }

  async send(message) {
    if (!this.enabled) return;
    try {
      await axios.post(
        `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`,
        {
          chat_id: config.telegram.chatId,
          text: message,
          parse_mode: 'HTML',
        }
      );
    } catch (err) {
      logger.warn('Telegram error: ' + err.message);
    }
  }

  async tradeOpened(position) {
    const mode = config.mode === 'paper' ? '📄 PAPER' : '🔴 LIVE';
    await this.send(
      `${mode} OPENED\n` +
      `🪙 <b>${position.symbol}</b>\n` +
      `💵 Size: $${position.sizeUSD.toFixed(2)}\n` +
      `🎯 Entry: $${position.entryPrice.toFixed(6)}\n` +
      `🛑 SL: $${position.stopLoss.toFixed(6)}\n` +
      `✅ TP: $${position.takeProfit.toFixed(6)}\n` +
      `📊 Score: ${position.score}/100`
    );
  }

  async tradeClosed(trade) {
    const emoji = trade.realizedPnL > 0 ? '✅' : '❌';
    const mode = config.mode === 'paper' ? '📄 PAPER' : '🔴 LIVE';
    await this.send(
      `${emoji} ${mode} CLOSED\n` +
      `🪙 <b>${trade.symbol}</b> [${trade.closeReason}]\n` +
      `💰 PnL: $${trade.realizedPnL.toFixed(3)} (${trade.realizedPct.toFixed(2)}%)`
    );
  }

  async alert(message) {
    await this.send(`⚠️ <b>ALERT</b>\n${message}`);
  }
}

module.exports = new Notifier();
