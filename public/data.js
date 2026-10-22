// ========== DATA FETCHING & PROCESSING ==========

const DataService = {
    rawData: null,
    processedData: null,
    previousData: null,

    async fetchOptionChain(symbol, type, expiry = '') {
        const endpoint = type === 'equities' ? '/api/option-chain/equities' : '/api/option-chain/indices';
        let url = `${endpoint}?symbol=${encodeURIComponent(symbol)}`;
        if (expiry) url += `&expiry=${encodeURIComponent(expiry)}`;
        
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data || !data.records || !data.records.data) throw new Error('Invalid data structure');
        return data;
    },



    async fetchSymbols() {
        try {
            const res = await fetch('/api/symbols');
            if (!res.ok) return [];
            return await res.json();
        } catch (e) {
            console.error("Failed to fetch symbols", e);
            return [];
        }
    },

    async fetchVolumeSurge() {
        const res = await fetch('/api/volume-surge');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    },

    async fetchHistoricalDelivery(symbol) {
        try {
            const res = await fetch(`/api/historical-delivery?symbol=${encodeURIComponent(symbol)}`);
            if (!res.ok) return null;
            return await res.json();
        } catch (e) {
            console.error("Failed to fetch historical delivery", e);
            return null;
        }
    },

    analyzeSmartMoney(histData) {
        if (!histData || !histData.data || histData.data.length < 5) return null;
        
        const data = histData.data;
        const first = data[0];
        const last = data[data.length - 1];
        
        const priceChange = ((last.closePrice - first.closePrice) / first.closePrice) * 100;
        const avgDeliveryFirstHalf = data.slice(0, Math.floor(data.length/2)).reduce((sum, d) => sum + d.deliveryPercentage, 0) / Math.floor(data.length/2);
        const avgDeliverySecondHalf = data.slice(Math.floor(data.length/2)).reduce((sum, d) => sum + d.deliveryPercentage, 0) / Math.ceil(data.length/2);
        
        const prices = data.map(d => d.closePrice);
        const latestPrice = prices[prices.length - 1];
        const deliveryTrend = avgDeliverySecondHalf - avgDeliveryFirstHalf;

        // --- Technical Indicators ---
        const calculateSMA = (arr, period) => {
            if (arr.length < period) return arr[arr.length - 1];
            const slice = arr.slice(arr.length - period);
            return slice.reduce((a, b) => a + b, 0) / period;
        };

        const calculateRSI = (arr, period = 14) => {
            if (arr.length <= period) return 50;
            let gains = 0, losses = 0;
            for (let i = 1; i <= period; i++) {
                const diff = arr[i] - arr[i-1];
                if (diff > 0) gains += diff; else losses -= diff;
            }
            let avgGain = gains / period;
            let avgLoss = losses / period;
            
            for (let i = period + 1; i < arr.length; i++) {
                const diff = arr[i] - arr[i-1];
                const gain = diff > 0 ? diff : 0;
                const loss = diff < 0 ? -diff : 0;
                avgGain = ((avgGain * (period - 1)) + gain) / period;
                avgLoss = ((avgLoss * (period - 1)) + loss) / period;
            }
            if (avgLoss === 0) return 100;
            const rs = avgGain / avgLoss;
            return 100 - (100 / (1 + rs));
        };

        const sma20 = calculateSMA(prices, 20);
        const rsi14 = calculateRSI(prices, 14);
        
        const isUptrend = latestPrice > sma20;
        const isDowntrend = latestPrice < sma20;
        
        let title = '';
        let description = '';
        let type = '';

        const deliverySurge = deliveryTrend > 1.5;
        const deliveryDrop = deliveryTrend < -1.5;
        const priceSurge = priceChange > 2.0;
        const priceDrop = priceChange < -2.0;

        // Enhanced Logic with RSI and SMA filters
        if (deliverySurge && priceSurge && isUptrend && rsi14 < 70) {
            title = '🟢 High-Conviction Buy (Strong Accumulation)';
            description = `Over the last 30 days, average delivery percentage increased (from ${avgDeliveryFirstHalf.toFixed(1)}% to ${avgDeliverySecondHalf.toFixed(1)}%) alongside a +${priceChange.toFixed(2)}% price surge.`;
            type = 'bullish';
        } else if (deliverySurge && priceDrop && isDowntrend && rsi14 > 30) {
            title = '🔴 High-Conviction Sell (Strong Distribution)';
            description = `Over the last 30 days, average delivery percentage increased (from ${avgDeliveryFirstHalf.toFixed(1)}% to ${avgDeliverySecondHalf.toFixed(1)}%) while the price fell by ${priceChange.toFixed(2)}%.`;
            type = 'bearish';
        } else if (deliverySurge && priceSurge && (rsi14 >= 70 || !isUptrend)) {
             title = '⚠️ Late Accumulation (Overbought Risk)';
             description = `Delivery percentage and price are rising, indicating accumulation, BUT the technical indicators show the stock is severely overextended. Buying now carries high pullback risk.`;
             type = 'bullish';
        } else if ((!deliverySurge && !deliveryDrop) && (!priceSurge && !priceDrop)) {
             title = '🟡 Consolidation';
             description = `Both delivery percentage and price have remained relatively flat over the last 30 days. The stock is in a consolidation phase. Wait for a breakout in price accompanied by a surge in delivery.`;
             type = 'neutral';
        } else if (priceSurge && !deliverySurge) {
            title = '⚠️ Speculative Rally (Caution)';
            description = `The stock price has rallied by +${priceChange.toFixed(2)}%, but the delivery percentage has NOT increased (currently averaging ${avgDeliverySecondHalf.toFixed(1)}%). This indicates the rally is largely driven by intraday speculation or short-covering rather than long-term institutional investment. Be cautious of a sudden reversal.`;
            type = 'neutral';
        } else if (priceDrop && !deliverySurge) {
            title = '⚠️ Speculative Fall (Weak Bearish)';
            description = `The stock price has fallen by ${priceChange.toFixed(2)}%, but the delivery percentage has NOT surged. This indicates the fall is likely driven by short-term traders rather than massive institutional liquidation. It may be nearing a support zone.`;
            type = 'neutral';
        } else {
            title = '🟡 Mixed / Indecisive';
            description = `The historical delivery data does not show a perfectly clear textbook pattern. Price changed by ${priceChange > 0 ? '+' : ''}${priceChange.toFixed(2)}% while delivery trended by ${deliveryTrend > 0 ? '+' : ''}${deliveryTrend.toFixed(2)}%. Wait for a clearer trend to emerge.`;
            type = 'neutral';
        }

        return { title, description, type, priceChange, avgDeliveryFirstHalf, avgDeliverySecondHalf };
    },

    processData(raw, selectedExpiry, strikeRange) {
        const records = raw.records;
        const filtered = raw.filtered;
        const allData = records.data;
        const spotPrice = records.underlyingValue;
        const expiryDates = records.expiryDates || [];

        const expiry = selectedExpiry || expiryDates[0];
        let strikeData = allData.filter(d => 
            d.expiryDate === expiry || 
            d.expiryDates === expiry || 
            (d.CE && d.CE.expiryDate === expiry) || 
            (d.PE && d.PE.expiryDate === expiry)
        );

        // Sort by strike
        strikeData.sort((a, b) => a.strikePrice - b.strikePrice);

        // Find ATM
        let atmStrike = strikeData[0]?.strikePrice || 0;
        let minDiff = Infinity;
        strikeData.forEach(d => {
            const diff = Math.abs(d.strikePrice - spotPrice);
            if (diff < minDiff) { minDiff = diff; atmStrike = d.strikePrice; }
        });

        // Filter by range
        if (strikeRange !== 'all') {
            const range = parseInt(strikeRange);
            const atmIdx = strikeData.findIndex(d => d.strikePrice === atmStrike);
            if (atmIdx >= 0) {
                const start = Math.max(0, atmIdx - range);
                const end = Math.min(strikeData.length, atmIdx + range + 1);
                strikeData = strikeData.slice(start, end);
            }
        }

        // Calculate metrics
        let totalCEOI = 0, totalPEOI = 0, totalCEOIChg = 0, totalPEOIChg = 0;
        let totalCEVol = 0, totalPEVol = 0;
        let atmCEIV = 0, atmPEIV = 0;

        // Calculate Time to Expiry (t) in years
        const expiryDateObj = new Date(expiry);
        expiryDateObj.setHours(15, 30, 0, 0); // NSE market close
        let t = (expiryDateObj - new Date()) / (1000 * 60 * 60 * 24 * 365);
        if (t <= 0) t = 0.0001; // Avoid divide by zero for DTE = 0

        strikeData.forEach(d => {
            if (d.CE) {
                totalCEOI += d.CE.openInterest || 0;
                totalCEOIChg += d.CE.changeinOpenInterest || 0;
                totalCEVol += d.CE.totalTradedVolume || 0;
                
                // Calculate IV if missing or zero
                if (!d.CE.impliedVolatility) {
                    d.CE.impliedVolatility = calculateImpliedVolatility('CE', spotPrice, d.strikePrice, t, RISK_FREE_RATE, d.CE.lastPrice);
                }
                // Calculate Greeks
                Object.assign(d.CE, calculateGreeks('CE', spotPrice, d.strikePrice, t, RISK_FREE_RATE, d.CE.impliedVolatility));
            }
            if (d.PE) {
                totalPEOI += d.PE.openInterest || 0;
                totalPEOIChg += d.PE.changeinOpenInterest || 0;
                totalPEVol += d.PE.totalTradedVolume || 0;
                
                // Calculate IV if missing or zero
                if (!d.PE.impliedVolatility) {
                    d.PE.impliedVolatility = calculateImpliedVolatility('PE', spotPrice, d.strikePrice, t, RISK_FREE_RATE, d.PE.lastPrice);
                }
                // Calculate Greeks
                Object.assign(d.PE, calculateGreeks('PE', spotPrice, d.strikePrice, t, RISK_FREE_RATE, d.PE.impliedVolatility));
            }
            if (d.strikePrice === atmStrike) {
                atmCEIV = d.CE?.impliedVolatility || 0;
                atmPEIV = d.PE?.impliedVolatility || 0;
            }
        });

        const pcr = totalCEOI > 0 ? (totalPEOI / totalCEOI) : 0;
        const maxPain = this.calculateMaxPain(strikeData);

        return {
            strikeData, spotPrice, atmStrike, expiryDates, expiry,
            totalCEOI, totalPEOI, totalCEOIChg, totalPEOIChg,
            totalCEVol, totalPEVol, atmCEIV, atmPEIV, pcr, maxPain,
            timestamp: records.timestamp || new Date().toLocaleString(),
            strikeDifference: records.strikeDifference,
            underlyingInfo: records.underlyingInfo || null
        };
    },

    calculateMaxPain(strikeData) {
        let minPain = Infinity;
        let maxPainStrike = 0;
        const strikes = strikeData.map(d => d.strikePrice);

        strikes.forEach(testStrike => {
            let totalPain = 0;
            strikeData.forEach(d => {
                if (d.CE && d.CE.openInterest) {
                    const ceIntrinsic = Math.max(0, testStrike - d.strikePrice);
                    // Wait - for max pain, we calculate pain to option BUYERS
                    // CE buyer pain = max(0, strikePrice - testStrike) ... no
                    // Actually: For calls, if spot > strike, call is ITM, pain to writer = spot-strike
                    // Max pain = strike where total writer payout is minimum
                    const cePayout = Math.max(0, testStrike - d.strikePrice) * d.CE.openInterest;
                    totalPain += cePayout;
                }
                if (d.PE && d.PE.openInterest) {
                    const pePayout = Math.max(0, d.strikePrice - testStrike) * d.PE.openInterest;
                    totalPain += pePayout;
                }
            });
            if (totalPain < minPain) {
                minPain = totalPain;
                maxPainStrike = testStrike;
            }
        });

        return maxPainStrike;
    },

    analyzePositions(strikeData) {
        const longBuildup = [], shortBuildup = [], shortCovering = [], longUnwinding = [];

        strikeData.forEach(d => {
            ['CE', 'PE'].forEach(type => {
                const opt = d[type];
                if (!opt) return;
                const priceChg = opt.change || 0;
                const oiChg = opt.changeinOpenInterest || 0;
                const entry = {
                    strike: d.strikePrice, type,
                    ltp: opt.lastPrice, priceChg,
                    oi: opt.openInterest, oiChg,
                    volume: opt.totalTradedVolume, iv: opt.impliedVolatility
                };

                if (priceChg > 0 && oiChg > 0) longBuildup.push(entry);
                else if (priceChg < 0 && oiChg > 0) shortBuildup.push(entry);
                else if (priceChg > 0 && oiChg < 0) shortCovering.push(entry);
                else if (priceChg < 0 && oiChg < 0) longUnwinding.push(entry);
            });
        });

        // Sort by absolute OI change
        const sortByOI = (a, b) => Math.abs(b.oiChg) - Math.abs(a.oiChg);
        return {
            longBuildup: longBuildup.sort(sortByOI),
            shortBuildup: shortBuildup.sort(sortByOI),
            shortCovering: shortCovering.sort(sortByOI),
            longUnwinding: longUnwinding.sort(sortByOI)
        };
    },

    getSupportResistance(strikeData, spotPrice) {
        const supports = [], resistances = [];
        strikeData.forEach(d => {
            if (d.PE && d.PE.openInterest > 0 && d.strikePrice <= spotPrice) {
                supports.push({ strike: d.strikePrice, oi: d.PE.openInterest, oiChg: d.PE.changeinOpenInterest || 0 });
            }
            if (d.CE && d.CE.openInterest > 0 && d.strikePrice >= spotPrice) {
                resistances.push({ strike: d.strikePrice, oi: d.CE.openInterest, oiChg: d.CE.changeinOpenInterest || 0 });
            }
        });
        supports.sort((a, b) => b.oi - a.oi);
        resistances.sort((a, b) => b.oi - a.oi);
        return { supports: supports.slice(0, 5), resistances: resistances.slice(0, 5) };
    }
};
