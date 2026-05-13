const express = require('express');
const path = require('path');
const config = require('../config');
const logger = require('./logger');

function createServer(bot) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../public')));

  // Health check — UptimeRobot pings this
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      mode: config.mode,
      uptime: process.uptime(),
      running: bot.running,
    });
  });

  // Bot status
  app.get('/api/status', (req, res) => {
    try {
      res.json(bot.getStatus());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Close a position manually
  app.post('/api/close/:pairAddress', async (req, res) => {
    try {
      const { pairAddress } = req.params;
      const pos = bot.engine.positions.get(pairAddress);
      if (!pos) return res.status(404).json({ error: 'Position not found' });

      const latest = bot.lastOpportunities.find(
        o => o.pairAddress === pairAddress
      );
      const price = latest?.priceUsd || pos.entryPrice;
      const closed = bot.engine.closePosition(pairAddress, price, 'manual');
      res.json({ success: true, trade: closed });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Stop bot
  app.post('/api/bot/stop', (req, res) => {
    bot.stop();
    res.json({ success: true, message: 'Bot stopped' });
  });

  // Start bot
  app.post('/api/bot/start', async (req, res) => {
    await bot.start();
    res.json({ success: true, message: 'Bot started' });
  });

  // Serve dashboard
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  });

  return app;
}

module.exports = createServer;
