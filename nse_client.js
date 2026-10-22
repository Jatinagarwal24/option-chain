/**
 * NSE client that talks to nseindia.com over HTTP/2.
 *
 * NSE blocks HTTP/1.1 connections coming from cloud/datacenter IPs (Render,
 * AWS, GCP...) but accepts the same requests over HTTP/2. The stock-nse-india
 * package uses axios (HTTP/1.1 only), so it gets 403s when deployed. This
 * client mirrors its public methods using Node's built-in http2 module.
 */
const http2 = require('http2');
const zlib = require('zlib');

const BASE_URL = 'https://www.nseindia.com';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const COOKIE_MAX_AGE_MS = 60 * 1000;
const REQUEST_TIMEOUT_MS = 30000;

function h2get(path, headers) {
    return new Promise((resolve, reject) => {
        const session = http2.connect(BASE_URL);
        const cleanup = () => { try { session.close(); } catch (e) { /* noop */ } };
        session.on('error', err => { cleanup(); reject(err); });

        const req = session.request({
            ':method': 'GET',
            ':path': path,
            ':authority': 'www.nseindia.com',
            ':scheme': 'https',
            ...headers
        });
        req.setTimeout(REQUEST_TIMEOUT_MS, () => {
            req.close(http2.constants.NGHTTP2_CANCEL);
            cleanup();
            reject(new Error(`NSE request timed out: ${path}`));
        });

        let responseHeaders = {};
        req.on('response', h => { responseHeaders = h; });

        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('error', err => { cleanup(); reject(err); });
        req.on('end', () => {
            cleanup();
            let body = Buffer.concat(chunks);
            try {
                const encoding = responseHeaders['content-encoding'];
                if (encoding === 'gzip') body = zlib.gunzipSync(body);
                else if (encoding === 'br') body = zlib.brotliDecompressSync(body);
                else if (encoding === 'deflate') body = zlib.inflateSync(body);
            } catch (e) {
                reject(new Error(`Failed to decompress NSE response: ${e.message}`));
                return;
            }
            resolve({
                status: responseHeaders[':status'],
                headers: responseHeaders,
                body: body.toString('utf8')
            });
        });
        req.end();
    });
}

class NseClient {
    constructor() {
        this.cookies = '';
        this.cookieExpiry = 0;
        this.cookieUsedCount = 0;
    }

    baseHeaders() {
        return {
            'user-agent': USER_AGENT,
            'accept': '*/*',
            'accept-language': 'en-US,en;q=0.9',
            'accept-encoding': 'gzip, deflate, br',
            'referer': 'https://www.nseindia.com/'
        };
    }

    async refreshCookies() {
        const res = await h2get('/get-quotes/equity?symbol=TCS', this.baseHeaders());
        const setCookies = res.headers['set-cookie'];
        if (setCookies) {
            const list = Array.isArray(setCookies) ? setCookies : [setCookies];
            this.cookies = list.map(c => c.split(';')[0]).join('; ');
            this.cookieExpiry = Date.now() + COOKIE_MAX_AGE_MS;
            this.cookieUsedCount = 0;
        }
    }

    async getNseCookies() {
        if (this.cookies === '' || this.cookieUsedCount > 10 || this.cookieExpiry <= Date.now()) {
            await this.refreshCookies();
        }
        this.cookieUsedCount++;
        return this.cookies;
    }

    async getDataByEndpoint(apiEndpoint) {
        let lastError;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const res = await h2get(apiEndpoint, {
                    ...this.baseHeaders(),
                    'cookie': await this.getNseCookies()
                });
                if (res.status === 401 || res.status === 403) {
                    // Stale/invalid cookies — force a refresh and retry
                    this.cookies = '';
                    lastError = new Error(`Request failed with status code ${res.status}`);
                    continue;
                }
                if (res.status !== 200) {
                    lastError = new Error(`Request failed with status code ${res.status}`);
                    continue;
                }
                return JSON.parse(res.body);
            } catch (err) {
                lastError = err;
            }
        }
        throw lastError;
    }

    async getAllStockSymbols() {
        const { data } = await this.getDataByEndpoint('/api/market-data-pre-open?key=ALL');
        return data.map(obj => obj.metadata.symbol).sort();
    }

    getEquityOptionChain(symbol) {
        return this.getDataByEndpoint('/api/NextApi/apiClient/GetQuoteApi?functionName=getSymbolDerivativesData' +
            `&symbol=${encodeURIComponent(symbol.toUpperCase())}`);
    }

    getIndexOptionChainContractInfo(indexSymbol) {
        return this.getDataByEndpoint(`/api/option-chain-contract-info?symbol=${encodeURIComponent(indexSymbol.toUpperCase())}`);
    }

    async getIndexOptionChain(indexSymbol, expiry) {
        if (!expiry) {
            const contractInfo = await this.getIndexOptionChainContractInfo(indexSymbol);
            const expiryDates = (contractInfo && contractInfo.expiryDates) || [];
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            let nearest = null;
            let nearestDate = null;
            for (const dateStr of expiryDates) {
                const [d, m, y] = dateStr.split('-');
                const month = months.indexOf(m);
                if (month === -1) continue;
                const date = new Date(parseInt(y, 10), month, parseInt(d, 10));
                if (date >= today && (!nearestDate || date < nearestDate)) {
                    nearestDate = date;
                    nearest = dateStr;
                }
            }
            expiry = nearest || expiryDates[expiryDates.length - 1];
            if (!expiry) throw new Error('Failed to determine expiry date');
        }
        return this.getDataByEndpoint('/api/option-chain-v3?type=Indices' +
            `&symbol=${encodeURIComponent(indexSymbol.toUpperCase())}` +
            `&expiry=${encodeURIComponent(expiry)}`);
    }
}

module.exports = { NseClient };
