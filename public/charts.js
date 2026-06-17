// ========== CHART RENDERING ==========

const Charts = {
    instances: {},

    destroy(id) {
        if (this.instances[id]) { this.instances[id].destroy(); delete this.instances[id]; }
    },

    destroyAll() {
        Object.keys(this.instances).forEach(id => this.destroy(id));
    },

    renderOIChart(data) {
        this.destroy('oiChart');
        const ctx = document.getElementById('oiChart');
        if (!ctx) return;
        const labels = data.strikeData.map(d => d.strikePrice);
        const ceOI = data.strikeData.map(d => d.CE?.openInterest || 0);
        const peOI = data.strikeData.map(d => d.PE?.openInterest || 0);

        this.instances['oiChart'] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'Call OI', data: ceOI, backgroundColor: CHART_COLORS.greenBg, borderColor: CHART_COLORS.green, borderWidth: 1 },
                    { label: 'Put OI', data: peOI, backgroundColor: CHART_COLORS.redBg, borderColor: CHART_COLORS.red, borderWidth: 1 }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top' },
                    annotation: this.getATMAnnotation(data)
                },
                scales: {
                    x: { grid: { color: CHART_COLORS.grid }, ticks: { maxRotation: 45 } },
                    y: { grid: { color: CHART_COLORS.grid }, ticks: { callback: v => formatNumber(v) } }
                }
            }
        });
    },

    renderOIChangeChart(data) {
        this.destroy('oiChangeChart');
        const ctx = document.getElementById('oiChangeChart');
        if (!ctx) return;
        const labels = data.strikeData.map(d => d.strikePrice);
        const ceChg = data.strikeData.map(d => d.CE?.changeinOpenInterest || 0);
        const peChg = data.strikeData.map(d => d.PE?.changeinOpenInterest || 0);

        this.instances['oiChangeChart'] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'Call OI Chg', data: ceChg, backgroundColor: ceChg.map(v => v > 0 ? CHART_COLORS.greenBg : 'rgba(16,185,129,0.1)'), borderColor: CHART_COLORS.green, borderWidth: 1 },
                    { label: 'Put OI Chg', data: peChg, backgroundColor: peChg.map(v => v > 0 ? CHART_COLORS.redBg : 'rgba(239,68,68,0.1)'), borderColor: CHART_COLORS.red, borderWidth: 1 }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    x: { grid: { color: CHART_COLORS.grid }, ticks: { maxRotation: 45 } },
                    y: { grid: { color: CHART_COLORS.grid }, ticks: { callback: v => formatNumber(v) } }
                }
            }
        });
    },

    renderOIPriceChart(data) {
        this.destroy('oiPriceChart');
        const ctx = document.getElementById('oiPriceChart');
        if (!ctx) return;
        const labels = data.strikeData.map(d => d.strikePrice);
        const ceOI = data.strikeData.map(d => d.CE?.openInterest || 0);
        const peOI = data.strikeData.map(d => d.PE?.openInterest || 0);

        this.instances['oiPriceChart'] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'Call OI', data: ceOI, backgroundColor: CHART_COLORS.greenBg, borderColor: CHART_COLORS.green, borderWidth: 1, order: 2 },
                    { label: 'Put OI', data: peOI, backgroundColor: CHART_COLORS.redBg, borderColor: CHART_COLORS.red, borderWidth: 1, order: 2 },
                    { label: 'Spot Price', data: labels.map(() => data.spotPrice), type: 'line', borderColor: CHART_COLORS.blue, borderWidth: 2, borderDash: [5, 5], pointRadius: 0, order: 1, yAxisID: 'y1' }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    x: { grid: { color: CHART_COLORS.grid }, ticks: { maxRotation: 45 } },
                    y: { grid: { color: CHART_COLORS.grid }, position: 'left', ticks: { callback: v => formatNumber(v) } },
                    y1: { grid: { display: false }, position: 'right', ticks: { callback: v => formatPrice(v) } }
                }
            }
        });
    },

    renderSRChart(data) {
        this.destroy('srChart');
        const ctx = document.getElementById('srChart');
        if (!ctx) return;
        const labels = data.strikeData.map(d => d.strikePrice);
        const ceOI = data.strikeData.map(d => d.CE?.openInterest || 0);
        const peOI = data.strikeData.map(d => d.PE?.openInterest || 0);

        this.instances['srChart'] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'Call OI (Resistance)', data: ceOI, backgroundColor: labels.map(s => s >= data.spotPrice ? CHART_COLORS.greenBg : 'rgba(5,150,105,0.05)'), borderColor: CHART_COLORS.green, borderWidth: 1 },
                    { label: 'Put OI (Support)', data: peOI, backgroundColor: labels.map(s => s <= data.spotPrice ? CHART_COLORS.redBg : 'rgba(220,38,38,0.05)'), borderColor: CHART_COLORS.red, borderWidth: 1 }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    x: { grid: { color: CHART_COLORS.grid }, ticks: { maxRotation: 45 } },
                    y: { grid: { color: CHART_COLORS.grid }, ticks: { callback: v => formatNumber(v) } }
                }
            }
        });
    },

    renderMaxPainChart(data) {
        this.destroy('maxPainChart');
        const ctx = document.getElementById('maxPainChart');
        if (!ctx) return;

        const strikes = data.strikeData.map(d => d.strikePrice);
        const painValues = strikes.map(testStrike => {
            let pain = 0;
            data.strikeData.forEach(d => {
                if (d.CE?.openInterest) pain += Math.max(0, testStrike - d.strikePrice) * d.CE.openInterest;
                if (d.PE?.openInterest) pain += Math.max(0, d.strikePrice - testStrike) * d.PE.openInterest;
            });
            return pain;
        });

        this.instances['maxPainChart'] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: strikes,
                datasets: [{
                    label: 'Total Pain', data: painValues,
                    borderColor: CHART_COLORS.yellow, backgroundColor: 'rgba(245,158,11,0.1)',
                    fill: true, tension: 0.3, pointRadius: 2
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    x: { grid: { color: CHART_COLORS.grid }, ticks: { maxRotation: 45 } },
                    y: { grid: { color: CHART_COLORS.grid }, ticks: { callback: v => formatNumber(v) } }
                }
            }
        });
    },

    renderIVSmileChart(data) {
        this.destroy('ivSmileChart');
        const ctx = document.getElementById('ivSmileChart');
        if (!ctx) return;
        const labels = data.strikeData.map(d => d.strikePrice);
        const ceIV = data.strikeData.map(d => d.CE?.impliedVolatility || 0);
        const peIV = data.strikeData.map(d => d.PE?.impliedVolatility || 0);

        this.instances['ivSmileChart'] = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { label: 'Call IV', data: ceIV, borderColor: CHART_COLORS.green, tension: 0.4, pointRadius: 2, fill: false },
                    { label: 'Put IV', data: peIV, borderColor: CHART_COLORS.red, tension: 0.4, pointRadius: 2, fill: false }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    x: { grid: { color: CHART_COLORS.grid }, ticks: { maxRotation: 45 } },
                    y: { grid: { color: CHART_COLORS.grid }, title: { display: true, text: 'IV %' } }
                }
            }
        });
    },

    renderIVSkewChart(data) {
        this.destroy('ivSkewChart');
        const ctx = document.getElementById('ivSkewChart');
        if (!ctx) return;
        const labels = data.strikeData.map(d => d.strikePrice);
        const skew = data.strikeData.map(d => {
            const ceIV = d.CE?.impliedVolatility || 0;
            const peIV = d.PE?.impliedVolatility || 0;
            return ceIV - peIV;
        });

        this.instances['ivSkewChart'] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{ label: 'IV Skew (CE - PE)', data: skew, backgroundColor: skew.map(v => v > 0 ? CHART_COLORS.greenBg : CHART_COLORS.redBg), borderColor: skew.map(v => v > 0 ? CHART_COLORS.green : CHART_COLORS.red), borderWidth: 1 }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                scales: {
                    x: { grid: { color: CHART_COLORS.grid }, ticks: { maxRotation: 45 } },
                    y: { grid: { color: CHART_COLORS.grid } }
                }
            }
        });
    },

    renderDeliveryHistoryChart(histData) {
        this.destroy('deliveryHistoryChart');
        const ctx = document.getElementById('deliveryHistoryChart');
        if (!ctx) return;

        if (!histData || !histData.data || histData.data.length === 0) return;

        const data = [...histData.data].sort((a, b) => new Date(a.date) - new Date(b.date));

        const labels = data.map(d => {
            const date = new Date(d.date);
            return `${date.getDate()}/${date.getMonth()+1}`;
        });
        const prices = data.map(d => d.closePrice);
        const deliveryPcts = data.map(d => d.deliveryPercentage);

        this.instances['deliveryHistoryChart'] = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Close Price',
                        data: prices,
                        borderColor: CHART_COLORS.blue,
                        backgroundColor: CHART_COLORS.blueBg,
                        borderWidth: 2,
                        yAxisID: 'yPrice',
                        tension: 0.4
                    },
                    {
                        label: 'Delivery %',
                        data: deliveryPcts,
                        borderColor: CHART_COLORS.green,
                        backgroundColor: CHART_COLORS.greenBg,
                        borderWidth: 2,
                        yAxisID: 'yDeliv',
                        type: 'bar',
                        barPercentage: 0.5
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: { grid: { color: CHART_COLORS.grid }, ticks: { color: CHART_COLORS.text, maxTicksLimit: 15 } },
                    yPrice: { 
                        type: 'linear', 
                        display: true, 
                        position: 'left',
                        grid: { color: CHART_COLORS.grid }, 
                        ticks: { color: CHART_COLORS.text },
                        title: { display: true, text: 'Price (₹)', color: CHART_COLORS.text }
                    },
                    yDeliv: { 
                        type: 'linear', 
                        display: true, 
                        position: 'right',
                        grid: { drawOnChartArea: false }, 
                        ticks: { color: CHART_COLORS.text, callback: v => v + '%' },
                        title: { display: true, text: 'Delivery %', color: CHART_COLORS.text },
                        min: 0,
                        max: 100
                    }
                },
                plugins: {
                    legend: { labels: { color: '#c9d1d9' } },
                    tooltip: {
                        backgroundColor: 'rgba(22, 27, 34, 0.9)',
                        titleColor: '#fff',
                        bodyColor: '#c9d1d9',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1
                    }
                }
            }
        });
    },

    getATMAnnotation(data) { return {}; }
};
