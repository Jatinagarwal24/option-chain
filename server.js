const express = require('express');
const cors = require('cors');
const path = require('path');
const { NseIndia } = require('stock-nse-india');

const app = express();
const PORT = 3000;

app.use(cors());
// --- PASSWORD PROTECTION ---
app.use((req, res, next) => {
    // Check for the Authorization header
    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [username, password] = Buffer.from(b64auth, 'base64').toString().split(':');

    // Default username is 'admin' and password is 'brother'
    if (username === 'admin' && password === 'admin') {
        return next(); // Password correct, load the site
    }

    // Password incorrect or not provided, show the browser login popup
    res.set('WWW-Authenticate', 'Basic realm="Private Dashboard"');
    res.status(401).send('Authentication required.');
});
// ---------------------------

app.use(express.static(path.join(__dirname, 'public')));

const nseIndia = new NseIndia();

// Simple cache to avoid hammering NSE
const cache = {};
const CACHE_TTL = 25000; // 25 seconds

async function getCachedData(key, fetchFn) {
    const cached = cache[key];
    if (cached && (Date.now() - cached.time) < CACHE_TTL) {
        return cached.data;
    }
    const data = await fetchFn();
    cache[key] = { data, time: Date.now() };
    return data;
}

// --- API Routes ---

app.get('/api/option-chain/indices', async (req, res) => {
    const symbol = req.query.symbol || 'NIFTY';
    try {
        const data = await getCachedData(`idx_${symbol}`, () =>
            nseIndia.getIndexOptionChain(symbol)
        );
        console.log(`[API] Option chain for ${symbol}: ${JSON.stringify(data).length} bytes`);
        res.json(data);
    } catch (error) {
        console.error(`[API] Error for ${symbol}:`, error.message);
        res.status(500).json({ error: 'Failed to fetch option chain data', details: error.message });
    }
});

app.get('/api/option-chain/equities', async (req, res) => {
    const symbol = req.query.symbol || 'RELIANCE';
    try {
        const data = await getCachedData(`eq_${symbol}`, async () => {
            const raw = await nseIndia.getEquityOptionChain(symbol);
            if (!raw || !raw.data) return raw;

            const rawData = raw.data;
            const timestamp = raw.timestamp || new Date().toLocaleString();
            let underlyingValue = 0;

            const options = rawData.filter(x => x.instrumentType === 'OPTSTK' || x.instrumentType === 'OPTIDX');
            if (options.length > 0) underlyingValue = options[0].underlyingValue;

            const expirySet = new Set();
            const strikeMap = {};

            options.forEach(opt => {
                if (!opt.expiryDate) return;
                expirySet.add(opt.expiryDate);
                const strike = parseFloat(opt.strikePrice);
                if (!strikeMap[strike]) strikeMap[strike] = {};

                if (!strikeMap[strike][opt.expiryDate]) {
                    strikeMap[strike][opt.expiryDate] = { strikePrice: strike, expiryDate: opt.expiryDate };
                }

                const optObj = {
                    strikePrice: strike,
                    expiryDate: opt.expiryDate,
                    underlying: opt.underlying,
                    identifier: opt.identifier,
                    openInterest: opt.openInterest,
                    changeinOpenInterest: opt.changeinOpenInterest,
                    pchangeinOpenInterest: opt.pchangeinOpenInterest,
                    totalTradedVolume: opt.totalTradedVolume,
                    impliedVolatility: opt.impliedVolatility || 0,
                    lastPrice: opt.lastPrice,
                    change: opt.change,
                    pchange: opt.pchange,
                    underlyingValue: opt.underlyingValue
                };

                if (opt.optionType === 'CE') strikeMap[strike][opt.expiryDate].CE = optObj;
                if (opt.optionType === 'PE') strikeMap[strike][opt.expiryDate].PE = optObj;
            });

            // NSE usually sorts expiries by date natively, let's just parse them
            const expiryDates = Array.from(expirySet).sort((a, b) => new Date(a) - new Date(b));
            const dataList = [];
            Object.keys(strikeMap).sort((a, b) => parseFloat(a) - parseFloat(b)).forEach(strike => {
                Object.values(strikeMap[strike]).forEach(row => dataList.push(row));
            });

            return {
                records: {
                    timestamp,
                    underlyingValue,
                    expiryDates,
                    data: dataList
                }
            };
        });
        console.log(`[API] Option chain for ${symbol}: ${JSON.stringify(data).length} bytes`);
        res.json(data);
    } catch (error) {
        console.error(`[API] Error for ${symbol}:`, error.message);
        res.status(500).json({ error: 'Failed to fetch option chain data', details: error.message });
    }
});

app.get('/api/market-status', async (req, res) => {
    try {
        const data = await getCachedData('market_status', () =>
            nseIndia.getDataByEndpoint('/api/marketStatus')
        );
        res.json(data);
    } catch (error) {
        console.error('[API] Market status error:', error.message);
        res.status(500).json({ error: 'Failed to fetch market status' });
    }
});

app.listen(PORT, () => {
    console.log(`\n🚀 Option Chain Analyzer running at http://localhost:${PORT}`);
    console.log(`📊 Open your browser and navigate to http://localhost:${PORT}\n`);
});
