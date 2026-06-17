// ========== MAIN APPLICATION ==========

const App = {
    refreshInterval: null,
    countdown: 30,
    countdownTimer: null,
    isLoading: false,

    async init() {
        chartDefaults();
        await this.loadSymbols();
        this.bindEvents();
        this.loadData();
        this.startAutoRefresh();
    },

    async loadSymbols() {
        const symbols = await DataService.fetchSymbols();
        const list = document.getElementById('symbolList');
        if (list && symbols.length > 0) {
            list.innerHTML = symbols.map(s => `<option value="${s}">`).join('');
        }
    },

    bindEvents() {
        // Tab navigation
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                const tab = document.getElementById('tab-' + btn.dataset.tab);
                if (tab) tab.classList.add('active');
            });
        });

        // Symbol change
        const symInput = document.getElementById('symbolSelect');
        if (symInput) {
            symInput.addEventListener('change', () => {
                const expSel = document.getElementById('expirySelect');
                if(expSel) expSel.value = ''; // reset expiry
                this.loadData();
            });
            // Also trigger on Enter key
            symInput.addEventListener('keyup', (e) => {
                if (e.key === 'Enter') {
                    symInput.blur();
                    this.loadData();
                }
            });
        }
        document.getElementById('expirySelect')?.addEventListener('change', () => this.loadData());
        document.getElementById('strikeRange')?.addEventListener('change', () => this.processAndRender());

        // Refresh button
        document.getElementById('refreshBtn')?.addEventListener('click', () => this.loadData());

        // Auto refresh toggle
        document.getElementById('autoRefresh')?.addEventListener('change', (e) => {
            if (e.target.checked) this.startAutoRefresh();
            else this.stopAutoRefresh();
        });
    },

    async loadData() {
        if (this.isLoading) return;
        this.isLoading = true;
        this.showLoading(true);

        const btn = document.getElementById('refreshBtn');
        if (btn) btn.classList.add('spinning');

        try {
            const select = document.getElementById('symbolSelect');
            const symbol = select.value.toUpperCase();
            // Since we don't have the select dataset anymore, default to equities unless it's a known index
            const indices = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'];
            const type = indices.includes(symbol) ? 'indices' : 'equities';
            const expirySelect = document.getElementById('expirySelect');
            const currentExpiry = expirySelect ? expirySelect.value : '';

            const [raw, histDeliveryRaw] = await Promise.all([
                DataService.fetchOptionChain(symbol, type, currentExpiry),
                DataService.fetchHistoricalDelivery(symbol)
            ]);
            DataService.rawData = raw;
            DataService.histDeliveryData = histDeliveryRaw;

            // Populate expiry dropdown
            const expiryDates = raw.records.expiryDates || [];
            if (expirySelect) {
                // If the currently selected expiry is not in the new list, clear it
                const selected = expiryDates.includes(currentExpiry) ? currentExpiry : expiryDates[0];
                expirySelect.innerHTML = expiryDates.map(d =>
                    `<option value="${d}" ${d === selected ? 'selected' : ''}>${d}</option>`
                ).join('');
            }

            this.processAndRender();
            this.updateMarketStatus('live');
        } catch (err) {
            console.error('Failed to load data:', err);
            this.updateMarketStatus('error');
            this.showError(err.message);
        } finally {
            this.isLoading = false;
            this.showLoading(false);
            if (btn) btn.classList.remove('spinning');
            this.resetCountdown();
        }
    },

    processAndRender() {
        if (!DataService.rawData) return;
        const expiry = document.getElementById('expirySelect')?.value || '';
        const range = document.getElementById('strikeRange')?.value || '10';

        const data = DataService.processData(DataService.rawData, expiry, range);
        DataService.processedData = data;

        // Render everything
        UI.renderMetrics(data);
        UI.renderOptionChainTable(data);
        UI.renderPositions(data);
        UI.renderSupportResistance(data);
        UI.renderGreeksTable(data);

        // Render charts
        Charts.renderOIChart(data);
        Charts.renderOIChangeChart(data);
        Charts.renderOIPriceChart(data);
        Charts.renderSRChart(data);
        Charts.renderMaxPainChart(data);
        Charts.renderIVSmileChart(data);
        Charts.renderIVSkewChart(data);

        // Render Smart Money
        const smartMoneyAnalysis = DataService.analyzeSmartMoney(DataService.histDeliveryData);
        UI.renderSmartMoneyAnalysis(smartMoneyAnalysis);
        if (DataService.histDeliveryData) {
            Charts.renderDeliveryHistoryChart(DataService.histDeliveryData);
        }
    },

    startAutoRefresh() {
        this.stopAutoRefresh();
        this.countdown = 30;
        this.countdownTimer = setInterval(() => {
            this.countdown--;
            const el = document.getElementById('countdown');
            if (el) el.textContent = this.countdown;
            if (this.countdown <= 0) {
                this.loadData();
            }
        }, 1000);
    },

    stopAutoRefresh() {
        if (this.countdownTimer) clearInterval(this.countdownTimer);
        this.countdownTimer = null;
    },

    resetCountdown() {
        this.countdown = 30;
        const el = document.getElementById('countdown');
        if (el) el.textContent = '30';
    },

    showLoading(show) {
        const overlay = document.getElementById('loadingOverlay');
        if (overlay) {
            if (show) overlay.classList.remove('hidden');
            else overlay.classList.add('hidden');
        }
    },

    updateMarketStatus(status) {
        const dot = document.querySelector('.status-dot');
        const text = document.querySelector('.status-text');
        if (!dot || !text) return;

        dot.className = 'status-dot';
        
        if (status === 'error') {
            dot.classList.add('closed');
            text.textContent = 'Connection Error';
            return;
        }

        // Determine if market is currently open in IST (UTC+5:30)
        const now = new Date();
        const utcHours = now.getUTCHours();
        const utcMinutes = now.getUTCMinutes();
        const utcDay = now.getUTCDay();
        
        let istMinutes = utcMinutes + 30;
        let istHours = utcHours + 5;
        let istDay = utcDay;

        if (istMinutes >= 60) {
            istMinutes -= 60;
            istHours += 1;
        }
        if (istHours >= 24) {
            istHours -= 24;
            istDay = (istDay + 1) % 7;
        }

        const isWeekend = istDay === 0 || istDay === 6;
        const currentMins = istHours * 60 + istMinutes;
        // Market open: 9:15 AM (555 mins) to 3:30 PM (930 mins)
        const isMarketOpen = !isWeekend && currentMins >= 555 && currentMins <= 930;

        if (isMarketOpen) {
            dot.classList.add('live');
            text.textContent = 'Market Live';
        } else {
            dot.classList.add('closed');
            text.textContent = 'Market Closed';
        }
    },

    showError(msg) {
        const tbody = document.getElementById('chainBody');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="23" class="loading-cell" style="color:var(--accent-red)">
                ❌ Error: ${msg}<br><small style="color:var(--text-muted)">Make sure the server is running and try again.</small>
            </td></tr>`;
        }
    }
};

// Start the app
document.addEventListener('DOMContentLoaded', () => App.init());
