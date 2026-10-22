/**
 * Groww public-data client — free, no login, works from cloud servers.
 *
 * NSE hard-blocks datacenter IPs at the Akamai edge, so Render can never
 * scrape NSE directly. Groww's website exposes public JSON endpoints (used by
 * its own option-chain pages) that are reachable from cloud hosts:
 *
 *   - POST groww.in/v1/api/stocks_fo_data/v1/tr_live_prices/exchange/NSE/segment/FNO/latest_prices_batch
 *       body: ["NIFTY26OCT25000CE", ...] -> per-contract ltp/volume/OI/prevOI/oiDayChange
 *   - GET  groww.in/v1/api/stocks_data/v1/tr_live_prices/exchange/NSE/segment/CASH/{SYMBOL}/latest
 *   - GET  groww.in/v1/api/stocks_data/v1/tr_live_indices/exchange/NSE/segment/CASH/{INDEX}/latest
 *
 * The contract universe (strikes/expiries per underlying) comes from Angel
 * One's public scrip-master file (a static JSON download, no account needed).
 *
 * Groww contract ids follow NSE trading-symbol conventions:
 *   monthly: NAME + YY + MMM + STRIKE + CE/PE     (RELIANCE26OCT1200CE)
 *   weekly:  NAME + YY + M + DD + STRIKE + CE/PE  (NIFTY26N0326000CE,
 *            month code 1-9 for Jan-Sep, O/N/D for Oct/Nov/Dec)
 *
 * Output shape matches what the frontend already consumes (NSE style).
 * Not available from these endpoints: bid/ask depth and server-side IV
 * (the frontend computes IV + Greeks itself via Black-Scholes).
 */
const https = require('https');

const SCRIP_MASTER_URL = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json';
const GROWW_BASE = 'https://groww.in';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_UPPER = MONTHS.map(m => m.toUpperCase());
const WEEKLY_MONTH_CODES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'O', 'N', 'D'];
const BATCH_SIZE = 50;
const BATCH_GAP_MS = 150;
const MAX_STRIKES_EACH_SIDE = 40;
const INDICES = { NIFTY: 'NIFTY', BANKNIFTY: 'BANKNIFTY', FINNIFTY: 'FINNIFTY', MIDCPNIFTY: 'MIDCPNIFTY' };

const sleep = ms => new Promise(r => setTimeout(r, ms));

function httpJson(method, url, body) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const payload = body === undefined ? null : JSON.stringify(body);
        const req = https.request({
            method,
            hostname: u.hostname,
            path: u.pathname + u.search,
            headers: {
                'user-agent': USER_AGENT,
                'accept': 'application/json, text/plain, */*',
                ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {})
            },
            timeout: 20000
        }, res => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', c => { data += c; });
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    return reject(new Error(`Groww HTTP ${res.statusCode} for ${u.pathname}: ${data.slice(0, 120)}`));
                }
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error(`Groww returned non-JSON for ${u.pathname}: ${data.slice(0, 120)}`)); }
            });
        });
        req.on('timeout', () => { req.destroy(new Error(`Groww request timed out: ${u.pathname}`)); });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

// ---------- scrip master (streamed + filtered to keep memory low) ----------
function downloadScripMaster(onRecord) {
    return new Promise((resolve, reject) => {
        const get = (url, redirects) => {
            https.get(url, { headers: { 'accept-encoding': 'identity', 'user-agent': 'option-chain-app' } }, res => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 3) {
                    res.resume();
                    return get(res.headers.location, redirects + 1);
                }
                if (res.statusCode !== 200) {
                    res.resume();
                    return reject(new Error(`Scrip master download failed: HTTP ${res.statusCode}`));
                }
                let buffer = '';
                let count = 0;
                res.setEncoding('utf8');
                res.on('data', chunk => {
                    buffer += chunk;
                    // Objects in the master are flat, so scanning for '}' is safe.
                    let start = buffer.indexOf('{');
                    while (start !== -1) {
                        const end = buffer.indexOf('}', start);
                        if (end === -1) break;
                        try {
                            onRecord(JSON.parse(buffer.slice(start, end + 1)));
                            count++;
                        } catch (e) { /* skip malformed fragment */ }
                        start = buffer.indexOf('{', end);
                    }
                    buffer = start === -1 ? '' : buffer.slice(start);
                });
                res.on('end', () => resolve(count));
                res.on('error', reject);
            }).on('error', reject);
        };
        get(SCRIP_MASTER_URL, 0);
    });
}

// Master expiry: "27OCT2026" (sometimes 2-digit year).
function parseMasterExpiry(raw) {
    const m = /^(\d{1,2})([A-Z]{3})(\d{2,4})$/.exec(raw || '');
    if (!m) return null;
    const month = MONTHS_UPPER.indexOf(m[2]);
    if (month === -1) return null;
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    return new Date(year, month, parseInt(m[1], 10));
}

function toDisplayExpiry(date) {
    return `${String(date.getDate()).padStart(2, '0')}-${MONTHS[date.getMonth()]}-${date.getFullYear()}`;
}

function istTimestamp() {
    const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
    return `${String(ist.getUTCDate()).padStart(2, '0')}-${MONTHS[ist.getUTCMonth()]}-${ist.getUTCFullYear()} ` +
        `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}:${String(ist.getUTCSeconds()).padStart(2, '0')}`;
}

function istDateKey() {
    return istTimestamp().slice(0, 11);
}

function strikeToken(strike) {
    // 1200 -> "1200", 1202.5 -> "1202.5"
    return Number.isInteger(strike) ? String(strike) : String(strike);
}

class GrowwClient {
    constructor() {
        this.options = {};      // name -> [{expiryDate, strike, type}]
        this.equityNames = {};  // 'RELIANCE' -> true (has -EQ listing)
        this.masterDay = '';
        this.masterCount = 0;
        this.masterPromise = null;
    }

    async ensureMaster() {
        if (this.masterDay === istDateKey() && this.masterCount > 0) return;
        if (this.masterPromise) return this.masterPromise;

        this.masterPromise = (async () => {
            const options = {}, equityNames = {};
            const total = await downloadScripMaster(rec => {
                if (rec.exch_seg === 'NFO' && (rec.instrumenttype === 'OPTSTK' || rec.instrumenttype === 'OPTIDX')) {
                    const expiryDate = parseMasterExpiry(rec.expiry);
                    if (!expiryDate) return;
                    const sym = rec.symbol || '';
                    const type = sym.endsWith('CE') ? 'CE' : (sym.endsWith('PE') ? 'PE' : null);
                    if (!type) return;
                    const strike = parseFloat(rec.strike) / 100;
                    if (!strike || strike <= 0) return;
                    const lot = parseInt(rec.lotsize, 10) || 1;
                    (options[rec.name] = options[rec.name] || []).push({ expiryDate, strike, type, lot });
                } else if (rec.exch_seg === 'NSE' && (rec.symbol || '').endsWith('-EQ')) {
                    equityNames[rec.name] = true;
                }
            });
            this.options = options;
            this.equityNames = equityNames;
            this.masterCount = total;
            this.masterDay = istDateKey();
            console.log(`[Groww] Scrip master loaded: ${total} records, ${Object.keys(options).length} option underlyings`);
        })();

        try {
            await this.masterPromise;
        } finally {
            this.masterPromise = null;
        }
    }

    /**
     * Groww contract id for one option. `monthlyExpiryTime` is the timestamp
     * of the LAST expiry of that contract's month for this underlying —
     * contracts expiring then use the monthly (MMM) notation, all others the
     * weekly (M+DD) notation.
     */
    growwContractId(name, expiryDate, strike, type, monthlyExpiryTime) {
        const yy = String(expiryDate.getFullYear() % 100).padStart(2, '0');
        const isMonthly = expiryDate.getTime() === monthlyExpiryTime;
        const mid = isMonthly
            ? MONTHS_UPPER[expiryDate.getMonth()]
            : WEEKLY_MONTH_CODES[expiryDate.getMonth()] + String(expiryDate.getDate()).padStart(2, '0');
        return `${name}${yy}${mid}${strikeToken(strike)}${type}`;
    }

    async fetchSpot(symbol) {
        try {
            if (INDICES[symbol]) {
                const d = await httpJson('GET',
                    `${GROWW_BASE}/v1/api/stocks_data/v1/tr_live_indices/exchange/NSE/segment/CASH/${encodeURIComponent(symbol)}/latest`);
                return d.value || d.ltp || 0;
            }
            const d = await httpJson('GET',
                `${GROWW_BASE}/v1/api/stocks_data/v1/tr_live_prices/exchange/NSE/segment/CASH/${encodeURIComponent(symbol)}/latest`);
            return d.ltp || 0;
        } catch (e) {
            console.error(`[Groww] Spot fetch failed for ${symbol}:`, e.message);
            return 0;
        }
    }

    async fetchQuotes(contractIds) {
        const out = {};
        for (let i = 0; i < contractIds.length; i += BATCH_SIZE) {
            const batch = contractIds.slice(i, i + BATCH_SIZE);
            const data = await httpJson('POST',
                `${GROWW_BASE}/v1/api/stocks_fo_data/v1/tr_live_prices/exchange/NSE/segment/FNO/latest_prices_batch`, batch);
            Object.assign(out, data);
            if (i + BATCH_SIZE < contractIds.length) await sleep(BATCH_GAP_MS);
        }
        return out;
    }

    async getAllStockSymbols() {
        await this.ensureMaster();
        return Object.keys(this.equityNames).filter(s => !s.includes('NSETEST')).sort();
    }

    async getOptionChain(symbol, expiryParam) {
        symbol = symbol.toUpperCase();
        await this.ensureMaster();
        const opts = this.options[symbol];
        if (!opts || !opts.length) throw new Error(`No derivatives found for ${symbol}`);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // upcoming expiries, display-formatted, sorted
        const expiryMap = new Map(); // display -> Date
        opts.forEach(o => {
            if (o.expiryDate >= today) expiryMap.set(toDisplayExpiry(o.expiryDate), o.expiryDate);
        });
        const expiryDates = [...expiryMap.keys()].sort((a, b) => expiryMap.get(a) - expiryMap.get(b));
        if (!expiryDates.length) throw new Error(`No active expiries for ${symbol}`);
        const expiry = expiryDates.includes(expiryParam) ? expiryParam : expiryDates[0];
        const expiryDate = expiryMap.get(expiry);

        // monthly notation applies to the last expiry within each month
        // (consider ALL expiries incl. past ones so mid-month weeklies resolve right)
        const monthKey = d => d.getFullYear() * 100 + d.getMonth();
        let monthlyExpiryTime = 0;
        opts.forEach(o => {
            if (monthKey(o.expiryDate) === monthKey(expiryDate)) {
                monthlyExpiryTime = Math.max(monthlyExpiryTime, o.expiryDate.getTime());
            }
        });

        const spot = await this.fetchSpot(symbol);

        // strikes for the chosen expiry, trimmed around ATM
        const chosen = opts.filter(o => o.expiryDate.getTime() === expiryDate.getTime());
        let strikes = [...new Set(chosen.map(o => o.strike))].sort((a, b) => a - b);
        if (spot > 0 && strikes.length > MAX_STRIKES_EACH_SIDE * 2) {
            let atmIdx = 0, minDiff = Infinity;
            strikes.forEach((s, i) => {
                const d = Math.abs(s - spot);
                if (d < minDiff) { minDiff = d; atmIdx = i; }
            });
            strikes = strikes.slice(Math.max(0, atmIdx - MAX_STRIKES_EACH_SIDE), atmIdx + MAX_STRIKES_EACH_SIDE + 1);
        }
        const keep = new Set(strikes);

        const idMeta = {};
        chosen.forEach(o => {
            if (!keep.has(o.strike)) return;
            const id = this.growwContractId(symbol, o.expiryDate, o.strike, o.type, monthlyExpiryTime);
            idMeta[id] = o;
        });

        const quotes = await this.fetchQuotes(Object.keys(idMeta));

        const rows = new Map();
        strikes.forEach(s => rows.set(s, { strikePrice: s, expiryDate: expiry }));
        let matched = 0;
        Object.keys(quotes).forEach(id => {
            const meta = idMeta[id];
            const q = quotes[id];
            if (!meta || !q) return;
            matched++;
            const row = rows.get(meta.strike);
            // Groww's oiDayChange/oiDayChangePerc use odd units; oi - prevOi
            // matches NSE's change-in-OI exactly. Volume is in lots.
            const oi = q.openInterest || 0;
            const prevOi = q.prevOpenInterest || 0;
            row[meta.type] = {
                strikePrice: meta.strike,
                expiryDate: expiry,
                underlying: symbol,
                identifier: id,
                openInterest: oi,
                changeinOpenInterest: oi - prevOi,
                pchangeinOpenInterest: prevOi > 0 ? ((oi - prevOi) / prevOi) * 100 : 0,
                totalTradedVolume: (q.volume || 0) * meta.lot,
                impliedVolatility: 0, // frontend computes IV via Black-Scholes
                lastPrice: q.ltp || 0,
                change: q.dayChange || 0,
                pchange: q.dayChangePerc || 0,
                bidQty: 0, // depth not exposed by these endpoints
                bidprice: 0,
                askPrice: 0,
                askQty: 0,
                underlyingValue: spot
            };
        });
        console.log(`[Groww] ${symbol} ${expiry}: ${matched}/${Object.keys(idMeta).length} contracts quoted`);

        return {
            records: {
                timestamp: istTimestamp(),
                underlyingValue: spot,
                expiryDates,
                data: [...rows.values()].sort((a, b) => a.strikePrice - b.strikePrice)
            }
        };
    }

    async debug() {
        const out = {};
        try {
            await this.ensureMaster();
            out.scripMaster = `OK (${this.masterCount} records, ${Object.keys(this.options).length} option underlyings)`;
        } catch (e) {
            out.scripMaster = `FAILED: ${e.message}`;
            return out;
        }
        try {
            out.spotNifty = await this.fetchSpot('NIFTY');
        } catch (e) {
            out.spotNifty = `FAILED: ${e.message}`;
        }
        try {
            const chain = await this.getOptionChain('RELIANCE');
            const withCE = chain.records.data.filter(r => r.CE && r.CE.lastPrice > 0).length;
            out.relianceChain = `OK (${chain.records.data.length} strikes, ${withCE} with live CE data, spot=${chain.records.underlyingValue})`;
        } catch (e) {
            out.relianceChain = `FAILED: ${e.message}`;
        }
        return out;
    }
}

module.exports = { GrowwClient };
