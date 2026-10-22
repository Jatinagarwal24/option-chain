const express = require('express');
const cors = require('cors');
const path = require('path');
const { GrowwClient } = require('./groww_client');

const app = express();
const PORT = process.env.PORT || 3000;


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

const groww = new GrowwClient();

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

app.get('/api/version', (req, res) => {
    res.json({ build: 'groww-v2' });
});

// Volume surge scan is heavy (~190 upstream calls), so cache for 5 minutes
// and share one in-flight scan between concurrent requests.
let surgeScan = { promise: null, data: null, time: 0 };
app.get('/api/volume-surge', async (req, res) => {
    try {
        if (surgeScan.data && (Date.now() - surgeScan.time) < 300000) {
            return res.json(surgeScan.data);
        }
        if (!surgeScan.promise) {
            surgeScan.promise = groww.getVolumeSurge()
                .then(data => { surgeScan = { promise: null, data, time: Date.now() }; return data; })
                .catch(err => { surgeScan.promise = null; throw err; });
        }
        res.json(await surgeScan.promise);
    } catch (error) {
        console.error('[API] Volume surge error:', error.message);
        res.status(500).json({ error: 'Failed to scan volumes', details: error.message });
    }
});

app.get('/api/debug-groww', async (req, res) => {
    try {
        res.json(await groww.debug());
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/option-chain/indices', async (req, res) => {
    const symbol = req.query.symbol || 'NIFTY';
    const expiry = req.query.expiry || '';
    try {
        const cacheKey = `idx_${symbol}_${expiry}`;
        const data = await getCachedData(cacheKey, () =>
            groww.getOptionChain(symbol, expiry)
        );
        console.log(`[API] Option chain for ${symbol} (${expiry || 'default'}): ${JSON.stringify(data).length} bytes`);
        res.json(data);
    } catch (error) {
        console.error(`[API] Error for ${symbol} (${expiry}):`, error.message);
        res.status(500).json({ error: 'Failed to fetch option chain data', details: error.message });
    }
});

app.get('/api/symbols', async (req, res) => {
    try {
        // Cache symbols for 1 hour since they don't change often
        const cached = cache['all_symbols'];
        if (cached && (Date.now() - cached.time) < 3600000) {
            return res.json(cached.data);
        }
        const data = await groww.getAllStockSymbols();
        cache['all_symbols'] = { data, time: Date.now() };
        res.json(data);
    } catch (error) {
        console.error('[API] Symbols error:', error.message);
        res.status(500).json({ error: 'Failed to fetch symbols' });
    }
});

app.get('/api/historical-delivery', async (req, res) => {
    const symbol = req.query.symbol || 'RELIANCE';
    try {
        const db = require('./db');
        const rows = db.getHistory(symbol);

        // If we have actual data in the DB, use it!
        if (rows && rows.length > 5) {
            console.log(`[API] Serving genuine historical data for ${symbol} (${rows.length} records)`);
            return res.json({ symbol, pattern: 3, data: rows });
        }

        // --- FALLBACK MOCK GENERATOR (if sync hasn't been run or data missing) ---
        console.log(`[API] No local DB data found for ${symbol}. Falling back to mock data...`);
        let hash = 0;
        for (let i = 0; i < symbol.length; i++) {
            hash = symbol.charCodeAt(i) + ((hash << 5) - hash);
        }
        
        const pattern = Math.abs(hash) % 3;
        const data = [];
        let currentPrice = 100 + (Math.abs(hash) % 2000);
        let currentDeliveryPct = 20 + (Math.abs(hash) % 20);
        
        const today = new Date();
        for(let i = 30; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(today.getDate() - i);
            
            if (date.getDay() === 0 || date.getDay() === 6) continue;

            const dayVolatility = (Math.random() - 0.5) * (currentPrice * 0.02);
            let priceChange = dayVolatility;
            let delivChange = (Math.random() - 0.5) * 5;

            if (pattern === 0) {
                priceChange += currentPrice * 0.005; 
                delivChange += 1.5; 
            } else if (pattern === 1) {
                priceChange -= currentPrice * 0.005; 
                delivChange += 1.5; 
            }
            
            currentPrice += priceChange;
            currentDeliveryPct += delivChange;
            if (currentDeliveryPct > 95) currentDeliveryPct = 95;
            if (currentDeliveryPct < 10) currentDeliveryPct = 10;
            if (currentPrice < 1) currentPrice = 1;

            const volume = 100000 + Math.floor(Math.random() * 500000);
            const deliveryVolume = Math.floor(volume * (currentDeliveryPct / 100));

            data.push({
                date: date.toISOString().split('T')[0],
                closePrice: parseFloat(currentPrice.toFixed(2)),
                volume: volume,
                deliveryVolume: deliveryVolume,
                deliveryPercentage: parseFloat(currentDeliveryPct.toFixed(2))
            });
        }
        
        res.json({ symbol, pattern, data });
    } catch (error) {
        console.error(`[API] Historical delivery error for ${symbol}:`, error.message);
        res.status(500).json({ error: 'Failed to fetch historical delivery' });
    }
});

app.get('/api/option-chain/equities', async (req, res) => {
    const symbol = req.query.symbol || 'RELIANCE';
    const expiry = req.query.expiry || '';
    try {
        const data = await getCachedData(`eq_${symbol}_${expiry}`, () =>
            groww.getOptionChain(symbol, expiry)
        );
        console.log(`[API] Option chain for ${symbol}: ${JSON.stringify(data).length} bytes`);
        res.json(data);
    } catch (error) {
        console.error(`[API] Error for ${symbol}:`, error.message);
        res.status(500).json({ error: 'Failed to fetch option chain data', details: error.message });
    }
});

app.get('/api/market-status', (req, res) => {
    // IST market hours: Mon-Fri 09:15-15:30
    const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
    const day = ist.getUTCDay();
    const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    const open = day >= 1 && day <= 5 && mins >= 555 && mins <= 930;
    res.json({ marketState: [{ market: 'Capital Market', marketStatus: open ? 'Open' : 'Closed' }] });
});



const { exec } = require('child_process');

app.listen(PORT, () => {
    console.log(`\n🚀 Option Chain Analyzer running at http://localhost:${PORT}`);
    console.log(`📊 Open your browser and navigate to http://localhost:${PORT}\n`);
    
    // Automate for Render: Run sync on startup
    console.log("⏳ Starting automated background Bhavcopy sync (this ensures Render always has fresh data)...");
    exec('npm run sync', (error, stdout, stderr) => {
        if (error) {
            console.error(`[Automated Sync Error]: ${error.message}`);
            return;
        }
        console.log(`✅ Automated Sync Complete! DB is up to date.`);
    });

    // Automate daily sync at 19:00 IST (13:30 UTC)
    setInterval(() => {
        const now = new Date();
        if (now.getUTCHours() === 13 && now.getUTCMinutes() === 30) {
            console.log("⏳ Running scheduled daily Bhavcopy sync...");
            exec('npm run sync');
        }
    }, 60000); // Check every minute
});
