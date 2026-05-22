// ========== UTILITY FUNCTIONS ==========

function formatNumber(num) {
    if (num === undefined || num === null || isNaN(num)) return '--';
    if (Math.abs(num) >= 10000000) return (num / 10000000).toFixed(2) + ' Cr';
    if (Math.abs(num) >= 100000) return (num / 100000).toFixed(2) + ' L';
    if (Math.abs(num) >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toLocaleString('en-IN');
}

function formatPrice(num) {
    if (num === undefined || num === null || isNaN(num)) return '--';
    return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(num) {
    if (num === undefined || num === null || isNaN(num)) return '--';
    const sign = num >= 0 ? '+' : '';
    return sign + num.toFixed(2) + '%';
}

function getChangeClass(val) {
    if (val > 0) return 'val-positive';
    if (val < 0) return 'val-negative';
    return '';
}

function safeVal(obj, key, fallback) {
    return obj && obj[key] !== undefined ? obj[key] : fallback;
}

// Chart.js default config for dark theme
const CHART_COLORS = {
    green: '#10b981',
    greenBg: 'rgba(16,185,129,0.25)',
    red: '#ef4444',
    redBg: 'rgba(239,68,68,0.25)',
    blue: '#6366f1',
    blueBg: 'rgba(99,102,241,0.25)',
    yellow: '#f59e0b',
    grid: 'rgba(148,163,184,0.08)',
    text: '#94a3b8',
};

function chartDefaults() {
    Chart.defaults.color = CHART_COLORS.text;
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.font.size = 11;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.pointStyleWidth = 10;
}

// ========== BLACK-SCHOLES GREEKS & IV CALCULATOR ==========

const RISK_FREE_RATE = 0.10; // 10% assumption for Indian markets

function standardNormalCDF(x) {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989423 * Math.exp(-x * x / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return x > 0 ? 1 - p : p;
}

function standardNormalPDF(x) {
    return Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
}

function calculateImpliedVolatility(type, S, K, t, r, marketPrice) {
    if (marketPrice <= 0 || t <= 0) return 0;
    
    let low = 0.001;
    let high = 5.0; // 500% max volatility
    let v = 0.5;
    
    // Bisection method (stable, robust)
    for (let i = 0; i < 40; i++) {
        const d1 = (Math.log(S / K) + (r + v * v / 2) * t) / (v * Math.sqrt(t));
        const d2 = d1 - v * Math.sqrt(t);
        
        let price = 0;
        if (type === 'CE') {
            price = S * standardNormalCDF(d1) - K * Math.exp(-r * t) * standardNormalCDF(d2);
        } else {
            price = K * Math.exp(-r * t) * standardNormalCDF(-d2) - S * standardNormalCDF(-d1);
        }
        
        const diff = price - marketPrice;
        if (Math.abs(diff) < 0.01) return v * 100;
        
        if (diff > 0) high = v;
        else low = v;
        
        v = (low + high) / 2;
    }
    return v * 100;
}

function calculateGreeks(type, S, K, t, r, v) {
    v = v / 100; // convert % to decimal
    if (t <= 0 || v <= 0 || S <= 0 || K <= 0) {
        return { delta: 0, gamma: 0, theta: 0, vega: 0 };
    }
    
    const d1 = (Math.log(S / K) + (r + v * v / 2) * t) / (v * Math.sqrt(t));
    const d2 = d1 - v * Math.sqrt(t);
    
    let delta, theta;
    const gamma = standardNormalPDF(d1) / (S * v * Math.sqrt(t));
    const vega = (S * standardNormalPDF(d1) * Math.sqrt(t)) / 100;
    
    if (type === 'CE') {
        delta = standardNormalCDF(d1);
        theta = (- (S * standardNormalPDF(d1) * v) / (2 * Math.sqrt(t)) - r * K * Math.exp(-r * t) * standardNormalCDF(d2)) / 365;
    } else {
        delta = standardNormalCDF(d1) - 1;
        theta = (- (S * standardNormalPDF(d1) * v) / (2 * Math.sqrt(t)) + r * K * Math.exp(-r * t) * standardNormalCDF(-d2)) / 365;
    }
    
    return { delta, gamma, theta, vega };
}
