const axios = require('axios');
const config = require('../config');
const logger = require('./logger');

// Well known high volume Solana tokens to always monitor
const DEFAULT_TOKENS = [
  { address: 'So11111111111111111111111111111111111111112',  symbol: 'SOL' },
  { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC' },
  { address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', symbol: 'RAY' },
  { address: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',  symbol: 'JUP' },
  { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK' },
  { address: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', symbol: 'WIF' },
  { address: 'MEFNBXixkEbait3xn9bkm8WsJzXtVsaJEn4c8Sam21u',  symbol: 'MEME' },
  { address: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', symbol: 'PYTH' },
  { address: 'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL',  symbol: 'JTO' },
  { address: 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof',  symbol: 'RNDR' },
];

class MarketScanner {
  constructor() {
    this.lastScan = null;
    this.opportunities = [];
    this.priceHistory = new Map();
  }

  sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // Jupiter price API — free, no rate limits
  async getJupiterPrices(addresses) {
    try {
      const ids = addresses.join(',');
      const res = await axios.get(
        `https://price.jup.ag/v4/price?ids=${ids}`,
        { timeout: 10000 }
      );
      return res.data?.data || {};
    } catch (err) {
      logger.warn('Jupiter price error: ' + err.message);
      return {};
    }
  }

  // Get pair data from DexScreener for a single token (low rate limit usage)
  async getDexData(tokenAddress) {
    try {
      await this.sleep(1000);
      const res = await axios.get(
        `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
        { timeout: 8000, headers: { 'Accept': 'application/json' } }
      );
      const pairs = (res.data?.pairs || [])
        .filter(p => p.chainId === 'solana')
        .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
      return pairs[0] || null;
    } catch (err) {
      return null;
    }
  }

  scoreOpportunity(pair, symbol) {
    let score = 0;
    const reasons = [];

    const liquidity    = pair.liquidity?.usd || 0;
    const volume24h    = pair.volume?.h24 || 0;
    const priceChange5m = pair.priceChange?.m5 || 0;
    const priceChange1h = pair.priceChange?.h1 || 0;
    const buys5m       = pair.txns?.m5?.buys || 0;
    const sells5m      = pair.txns?.m5?.sells || 0;
    const totalTxns5m  = buys5m + sells5m;
    const buyPressure  = totalTxns5m > 0 ? (buys5m / totalTxns5m) * 100 : 50;

    if (liquidity >= config.scanner.minLiquidityUSD) {
      score += Math.min(25, (liquidity / config.scanner.minLiquidityUSD) * 10);
      reasons.push(`Liq $${(liquidity/1000).toFixed(0)}K`);
    } else {
      return { score: 0, reasons: ['Low liquidity'] };
    }

    if (volume24h >= config.scanner.minVolume24h) {
      score += Math.min(20, (volume24h / config.scanner.minVolume24h) * 8);
      reasons.push(`Vol $${(volume24h/1000).toFixed(0)}K`);
    }

    if (buyPressure >= config.scanner.minBuyPressurePercent) {
      score += Math.min(25, (buyPressure - 50) * 1.25);
      reasons.push(`Buys ${buyPressure.toFixed(0)}%`);
    }

    if (priceChange5m > 0.3 && priceChange5m < 20) {
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

    if (totalTxns5m < 3) {
      score -= 10;
    }

    return { score: Math.max(0, Math.round(score)), reasons };
  }

  async scan() {
    logger.info('Scanning Solana markets...');
    const results = [];

    // Build token list
    const watchList = config.scanner.watchList.length > 0
      ? config.scanner.watchList.map(a => ({ address: a, symbol: a.slice(0,6) }))
      : DEFAULT_TOKENS;

    // Scan each token with delay to avoid rate limits
    for (const token of watchList) {
      const pair = await this.getDexData(token.address);
      if (!pair) continue;

      const { score, reasons } = this.scoreOpportunity(pair, token.symbol);

      results.push({
        pairAddress: pair.pairAddress,
        baseToken: pair.baseToken || { symbol: token.symbol, address: token.address },
        quoteToken: pair.quoteToken || { symbol: 'USDC' },
        dexId: pair.dexId || 'raydium',
        priceUsd: parseFloat(pair.priceUsd) || 0,
        priceChange: {
          m5:  pair.priceChange?.m5  || 0,
          h1:  pair.priceChange?.h1  || 0,
          h24: pair.priceChange?.h24 || 0,
        },
        liquidity: pair.liquidity?.usd || 0,
        volume24h: pair.volume?.h24   || 0,
        txns5m: pair.txns?.m5 || { buys: 0, sells: 0 },
        score,
        reasons,
        scannedAt: new Date().toISOString(),
      });
    }

    const scored = results
      .filter(p => p.score >= 30)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    this.opportunities = scored;
    this.lastScan = new Date().toISOString();
    logger.info(`Scan done — ${scored.length} opportunities found`);
    return scored;
  }
}

module.exports = new MarketScanner();
