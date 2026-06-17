// ========== UI RENDERING ==========

const UI = {
    renderOptionChainTable(data) {
        const tbody = document.getElementById('chainBody');
        if (!tbody) return;
        const maxCEOI = Math.max(...data.strikeData.map(d => d.CE?.openInterest || 0));
        const maxPEOI = Math.max(...data.strikeData.map(d => d.PE?.openInterest || 0));

        let html = '';
        data.strikeData.forEach(d => {
            const ce = d.CE || {};
            const pe = d.PE || {};
            const isATM = d.strikePrice === data.atmStrike;
            const isITMCE = d.strikePrice < data.spotPrice;
            const isITMPE = d.strikePrice > data.spotPrice;
            let rowClass = '';
            if (isATM) rowClass = 'atm-row';
            else if (isITMCE) rowClass = 'itm-ce';
            else if (isITMPE) rowClass = 'itm-pe';

            const ceOIPercent = maxCEOI > 0 ? ((ce.openInterest || 0) / maxCEOI * 100) : 0;
            const peOIPercent = maxPEOI > 0 ? ((pe.openInterest || 0) / maxPEOI * 100) : 0;
            const ceOIHigh = ceOIPercent > 70 ? 'oi-high-ce' : '';
            const peOIHigh = peOIPercent > 70 ? 'oi-high-pe' : '';

            const cePrevOI = (ce.openInterest || 0) - (ce.changeinOpenInterest || 0);
            const pePrevOI = (pe.openInterest || 0) - (pe.changeinOpenInterest || 0);

            html += `<tr class="${rowClass}">
                <td class="ce-col">${formatNumber(Math.max(0, cePrevOI))}</td>
                <td class="ce-col ${ceOIHigh}">${formatNumber(ce.openInterest)}</td>
                <td class="ce-col ${getChangeClass(ce.changeinOpenInterest)}">${formatNumber(ce.changeinOpenInterest)}</td>
                <td class="ce-col">${formatNumber(ce.totalTradedVolume)}</td>
                <td class="ce-col">${ce.impliedVolatility?.toFixed(2) || '--'}</td>
                <td class="ce-col">${formatPrice(ce.lastPrice)}</td>
                <td class="ce-col ${getChangeClass(ce.change)}">${ce.change?.toFixed(2) || '--'}</td>
                <td class="ce-col">${formatNumber(ce.bidQty)}</td>
                <td class="ce-col">${formatPrice(ce.bidprice)}</td>
                <td class="ce-col">${formatPrice(ce.askPrice)}</td>
                <td class="ce-col">${formatNumber(ce.askQty)}</td>
                <td class="strike-cell">${d.strikePrice}</td>
                <td class="pe-col">${formatNumber(pe.bidQty)}</td>
                <td class="pe-col">${formatPrice(pe.bidprice)}</td>
                <td class="pe-col">${formatPrice(pe.askPrice)}</td>
                <td class="pe-col">${formatNumber(pe.askQty)}</td>
                <td class="pe-col ${getChangeClass(pe.change)}">${pe.change?.toFixed(2) || '--'}</td>
                <td class="pe-col">${formatPrice(pe.lastPrice)}</td>
                <td class="pe-col">${pe.impliedVolatility?.toFixed(2) || '--'}</td>
                <td class="pe-col">${formatNumber(pe.totalTradedVolume)}</td>
                <td class="pe-col ${getChangeClass(pe.changeinOpenInterest)}">${formatNumber(pe.changeinOpenInterest)}</td>
                <td class="pe-col ${peOIHigh}">${formatNumber(pe.openInterest)}</td>
                <td class="pe-col">${formatNumber(Math.max(0, pePrevOI))}</td>
            </tr>`;
        });
        tbody.innerHTML = html;

        // Scroll to ATM row
        setTimeout(() => {
            const atmRow = tbody.querySelector('.atm-row');
            if (atmRow) atmRow.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, 100);
    },

    renderMetrics(data) {
        // PCR
        const pcrEl = document.getElementById('pcrValue');
        const pcrSent = document.getElementById('pcrSentiment');
        if (pcrEl) pcrEl.textContent = data.pcr.toFixed(2);
        if (pcrSent) {
            if (data.pcr > 1.3) { pcrSent.textContent = '🟢 Bullish'; pcrSent.className = 'metric-sub bullish'; }
            else if (data.pcr < 0.7) { pcrSent.textContent = '🔴 Bearish'; pcrSent.className = 'metric-sub bearish'; }
            else { pcrSent.textContent = '🟡 Neutral'; pcrSent.className = 'metric-sub neutral'; }
        }

        // Max Pain
        const mpEl = document.getElementById('maxPainValue');
        const mpDiff = document.getElementById('maxPainDiff');
        if (mpEl) mpEl.textContent = formatPrice(data.maxPain);
        if (mpDiff) {
            const diff = data.spotPrice - data.maxPain;
            mpDiff.textContent = `Spot ${diff >= 0 ? '+' : ''}${diff.toFixed(0)} from MP`;
            mpDiff.className = `metric-sub ${diff >= 0 ? 'bullish' : 'bearish'}`;
        }

        // Total OI
        const toEl = document.getElementById('totalOIValue');
        const toSub = document.getElementById('totalOISub');
        if (toEl) toEl.textContent = formatNumber(data.totalCEOI + data.totalPEOI);
        if (toSub) toSub.textContent = `CE: ${formatNumber(data.totalCEOI)} | PE: ${formatNumber(data.totalPEOI)}`;

        // OI Change
        const ocEl = document.getElementById('oiChangeValue');
        const ocSub = document.getElementById('oiChangeSub');
        const netOIChg = data.totalCEOIChg + data.totalPEOIChg;
        if (ocEl) ocEl.textContent = formatNumber(netOIChg);
        if (ocSub) ocSub.textContent = `CE: ${formatNumber(data.totalCEOIChg)} | PE: ${formatNumber(data.totalPEOIChg)}`;

        // IV
        const ivEl = document.getElementById('ivValue');
        const ivSub = document.getElementById('ivSub');
        if (ivEl) ivEl.textContent = ((data.atmCEIV + data.atmPEIV) / 2).toFixed(2) + '%';
        if (ivSub) ivSub.textContent = `CE: ${data.atmCEIV.toFixed(1)}% | PE: ${data.atmPEIV.toFixed(1)}%`;

        // Volume
        const volEl = document.getElementById('volumeValue');
        const volSub = document.getElementById('volumeSub');
        if (volEl) volEl.textContent = formatNumber(data.totalCEVol + data.totalPEVol);
        if (volSub) volSub.textContent = `CE: ${formatNumber(data.totalCEVol)} | PE: ${formatNumber(data.totalPEVol)}`;

        // Spot
        const spEl = document.querySelector('.spot-value');
        if (spEl) spEl.textContent = formatPrice(data.spotPrice);

        // Timestamp
        const tsEl = document.getElementById('lastUpdated');
        if (tsEl) tsEl.textContent = `Last Updated: ${data.timestamp}`;


    },

    renderPositions(data) {
        const positions = DataService.analyzePositions(data.strikeData);
        ['longBuildup', 'shortBuildup', 'shortCovering', 'longUnwinding'].forEach(key => {
            const listId = key + 'List';
            const el = document.getElementById(listId);
            if (!el) return;
            const items = positions[key];
            if (!items.length) { el.innerHTML = '<div class="loading-text">No activity detected</div>'; return; }
            el.innerHTML = items.slice(0, 10).map(item => `
                <div class="position-item">
                    <span class="strike-info">${item.strike}</span>
                    <span class="type-badge ${item.type.toLowerCase()}">${item.type}</span>
                    <span class="oi-info">OI Chg: ${formatNumber(item.oiChg)}</span>
                    <span class="price-chg ${getChangeClass(item.priceChg)}">${item.priceChg >= 0 ? '+' : ''}${item.priceChg?.toFixed(2)}</span>
                </div>
            `).join('');
        });

        // Summary
        const sumEl = document.getElementById('positionSummary');
        if (sumEl) {
            const cats = [
                { label: 'Long Buildup', items: positions.longBuildup, color: 'var(--accent-green)' },
                { label: 'Short Buildup', items: positions.shortBuildup, color: 'var(--accent-red)' },
                { label: 'Short Covering', items: positions.shortCovering, color: 'var(--accent-yellow)' },
                { label: 'Long Unwinding', items: positions.longUnwinding, color: 'var(--accent-orange)' }
            ];
            sumEl.innerHTML = cats.map(c => {
                const totalOIChg = c.items.reduce((s, i) => s + Math.abs(i.oiChg), 0);
                return `<div class="summary-item">
                    <div class="summary-label">${c.label}</div>
                    <div class="summary-value" style="color:${c.color}">${c.items.length}</div>
                    <div class="summary-count">Strikes | OI: ${formatNumber(totalOIChg)}</div>
                </div>`;
            }).join('');
        }
    },

    renderSupportResistance(data) {
        const sr = DataService.getSupportResistance(data.strikeData, data.spotPrice);

        const supEl = document.getElementById('supportLevels');
        if (supEl) {
            if (!sr.supports.length) { supEl.innerHTML = '<div class="loading-text">No data</div>'; }
            else {
                const maxOI = sr.supports[0]?.oi || 1;
                supEl.innerHTML = sr.supports.map((s, i) => `
                    <div class="sr-level-item support">
                        <div class="sr-bar" style="width:${(s.oi / maxOI * 100)}%"></div>
                        <span class="sr-rank">${i + 1}</span>
                        <span class="sr-strike">${s.strike}</span>
                        <span class="sr-oi">OI: ${formatNumber(s.oi)} | Chg: ${formatNumber(s.oiChg)}</span>
                    </div>
                `).join('');
            }
        }

        const resEl = document.getElementById('resistanceLevels');
        if (resEl) {
            if (!sr.resistances.length) { resEl.innerHTML = '<div class="loading-text">No data</div>'; }
            else {
                const maxOI = sr.resistances[0]?.oi || 1;
                resEl.innerHTML = sr.resistances.map((r, i) => `
                    <div class="sr-level-item resistance">
                        <div class="sr-bar" style="width:${(r.oi / maxOI * 100)}%"></div>
                        <span class="sr-rank">${i + 1}</span>
                        <span class="sr-strike">${r.strike}</span>
                        <span class="sr-oi">OI: ${formatNumber(r.oi)} | Chg: ${formatNumber(r.oiChg)}</span>
                    </div>
                `).join('');
            }
        }
    },

    renderGreeksTable(data) {
        const tbody = document.getElementById('greeksBody');
        if (!tbody) return;
        const nearATM = data.strikeData.filter(d => Math.abs(d.strikePrice - data.atmStrike) <= (data.strikeDifference || 50) * 5);

        let html = '';
        nearATM.forEach(d => {
            const ce = d.CE || {};
            const pe = d.PE || {};
            const isATM = d.strikePrice === data.atmStrike;
            html += `<tr class="${isATM ? 'atm-row' : ''}">
                <td class="ce-col">${ce.delta?.toFixed(4) || '--'}</td>
                <td class="ce-col">${ce.gamma?.toFixed(4) || '--'}</td>
                <td class="ce-col">${ce.theta?.toFixed(4) || '--'}</td>
                <td class="ce-col">${ce.vega?.toFixed(4) || '--'}</td>
                <td class="ce-col">${ce.impliedVolatility?.toFixed(2) || '--'}</td>
                <td class="strike-cell">${d.strikePrice}</td>
                <td class="pe-col">${pe.impliedVolatility?.toFixed(2) || '--'}</td>
                <td class="pe-col">${pe.vega?.toFixed(4) || '--'}</td>
                <td class="pe-col">${pe.theta?.toFixed(4) || '--'}</td>
                <td class="pe-col">${pe.gamma?.toFixed(4) || '--'}</td>
                <td class="pe-col">${pe.delta?.toFixed(4) || '--'}</td>
            </tr>`;
        });
        tbody.innerHTML = html || '<tr><td colspan="11" class="loading-cell">No greeks data available</td></tr>';
    },

    renderSmartMoneyAnalysis(analysis) {
        const reportEl = document.getElementById('smartMoneyReport');
        if (!reportEl) return;
        
        if (!analysis) {
            reportEl.innerHTML = '<div class="loading-text">Not enough historical data to analyze delivery patterns.</div>';
            return;
        }

        let color = 'var(--text-color)';
        if (analysis.type === 'bullish') color = 'var(--accent-green)';
        else if (analysis.type === 'bearish') color = 'var(--accent-red)';
        else color = 'var(--accent-yellow)';

        reportEl.innerHTML = `
            <h2 style="color: ${color}; margin-bottom: 15px;">${analysis.title}</h2>
            <p style="color: var(--text-muted);">${analysis.description}</p>
        `;
    }
};
