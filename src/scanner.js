const axios = require('axios');
const config = require('../config');
const logger = require('./logger');

const DEXSCREENER_API = 'https://api.dexscreener.com';

class MarketScanner {
  constructor() {
    this.lastScan = null;
    this.opportunities = [];
  }

  async getTopSolanaPairs() {
    try {
      const res = await axios.get(
        `${DEXSCREENER_API}/token-profiles/latest/v1`,
        {
          timeout: 10000,
          headers: { 'Accept': 'application/json' },
        }
      );
      const tokens = res.data || [];
      const solTokens = tokens
        .filter(t => t.chainId === 'solana')
        .slice(0, 20);

      const pairs = [];
      for (const token of solTokens.slice(0, 8)) {
        await this.sleep(500);
        try {
          const r = await axios.get(
            `${DEXSCREENER_API}/latest/dex/tokens/${token.tokenAddress}`,
            { timeout: 8000, headers: { 'Accept': 'application/json' } }
          );
          const p = (r.data?.pairs || [])
            .filter(x => x.chainId === 'solana')
            .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
          if (p) pairs.push(p);
        } catch (_) {}
      }
      return pairs;
    } catch (err) {
      logger.warn('Token profiles error: ' + err.message);
      return [];
    }
  }

  async getTokenData(mintAddress) {
    try {
      const res = await axios.get(
        `${DEXSCREENER_API}/latest/dex/tokens/${mintAddress}`,
        { timeout: 8000, headers: { 'Accept': 'application/json' } }
      );
      return (res.data?.pairs || [])
        .filter(p => p.chainId === 'solana')
        .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0] || null;
    } catch (err) {
      logger.warn('Token fetch error: ' + err.message);
      return null;
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  scoreOpportunity(pair) {
    let score = 0;
    const reasons = [];

    const liquidity = pair.liquidity?.usd || 0;
    const volume24h = pair.volume?.h24 || 0;
    const priceChange5m = pair.priceChange?.m5 || 0;
    const priceChange1h = pair.priceChange?.h1 || 0;
    const buys5m = pair.txns?.m5?.buys || 0;
    const sells5m = pair.txns?.m5?.sells || 0;
    const totalTxns5m = buys5m + sells5m;
    const buyPressure = totalTxns5m > 0 ? (buys5m / totalTxns5m) * 100 : 50;

    if (liquidity >= config.scanner.minLiquidityUSD) {
      score += Math.min(25, (liquidity / config.scanner.minLiquidityUSD) * 10);
      reasons.push(`Liq $${(liquidity / 1000).toFixed(0)}K`);
    } else {
      return { score: 0, reasons: ['Low liquidity'] };
    }

    if (volume24h >= config.scanner.minVolume24h) {
      score += Math.min(20, (volume24h / config.scanner.minVolume24h) * 8);
      reasons.push(`Vol $${(volume24h / 1000).toFixed(0)}K`);
    }

    if (buyPressure >= config.scanner.minBuyPressurePercent) {
      score += Math.min(25, (buyPressure - 50) * 1.25);
      reasons.push(`Buys ${buyPressure.toFixed(0)}%`);
    }

    if (priceChange5m > 0.5 && priceChange5m < 20) {
      score += Math.min(20, priceChange5m * 2);
      reasons.push(`+${priceChange5m.toFixed(2)}% 5m`);
    } else if (priceChange5m >= 20) {
      score -= 15;
      reasons.push('Overextended');
    }

    if (priceChange1h > 0 && priceChange5m > 0) {
      score += 10;
      reasons.push('1h aligned');
    }

    if (totalTxns5m < 5) {
      score -= 20;
      reasons.push('Low activity');
    }

    return { score: Math.max(0, Math.round(score)), reasons };
  }

  async scan() {
    logger.info('Scanning Solana markets...');
    const allPairs = [];

    if (config.scanner.watchList.length > 0) {
      for (const mint of config.scanner.watchList) {
        await this.sleep(300);
        const pair = await this.getTokenData(mint);
        if (pair) allPairs.push(pair);
      }
    }

    const trending = await this.getTopSolanaPairs();
    allPairs.push(...trending);

    const seen = new Set();
    const unique = allPairs.filter(p => {
      if (seen.has(p.pairAddress)) return false;
      seen.add(p.pairAddress);
      return true;
    });

    const scored = unique
      .map(pair => {
        const { score, reasons } = this.scoreOpportunity(pair);
        return {
          pairAddress: pair.pairAddress,
          baseToken: pair.baseToken,
          quoteToken: pair.quoteToken,
          dexId: pair.dexId,
          priceUsd: parseFloat(pair.priceUsd) || 0,
          priceChange: {
            m5: pair.priceChange?.m5 || 0,
            h1: pair.priceChange?.h1 || 0,
            h24: pair.priceChange?.h24 || 0,
          },
          liquidity: pair.liquidity?.usd || 0,
          volume24h: pair.volume?.h24 || 0,
          txns5m: pair.txns?.m5 || { buys: 0, sells: 0 },
          score,
          reasons,
          scannedAt: new Date().toISOString(),
        };
      })
      .filter(p => p.score >= 40)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    this.opportunities = scored;
    this.lastScan = new Date().toISOString();
    logger.info(`Scan done — ${scored.length} opportunities found`);
    return scored;
  }
}

module.exports = new MarketScanner();
