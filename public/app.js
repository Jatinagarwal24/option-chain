// ========== MAIN APPLICATION ==========

const App = {
    refreshInterval: null,
    countdown: 30,
    countdownTimer: null,
    isLoading: false,

    init() {
        chartDefaults();
        this.bindEvents();
        this.loadData();
        this.startAutoRefresh();
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
        document.getElementById('symbolSelect')?.addEventListener('change', () => this.loadData());
        document.getElementById('expirySelect')?.addEventListener('change', () => this.processAndRender());
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
            const symbol = select.value;
            const type = select.selectedOptions[0]?.dataset.type || 'indices';

            const raw = await DataService.fetchOptionChain(symbol, type);
            DataService.rawData = raw;

            // Populate expiry dropdown
            const expirySelect = document.getElementById('expirySelect');
            const currentExpiry = expirySelect?.value;
            const expiryDates = raw.records.expiryDates || [];
            if (expirySelect) {
                expirySelect.innerHTML = expiryDates.map((d, i) =>
                    `<option value="${d}" ${d === currentExpiry || (!currentExpiry && i === 0) ? 'selected' : ''}>${d}</option>`
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
        if (status === 'live') {
            dot.classList.add('live');
            text.textContent = 'Market Live';
        } else if (status === 'error') {
            dot.classList.add('closed');
            text.textContent = 'Connection Error';
        } else {
            text.textContent = 'Connecting...';
        }
    },

    showError(msg) {
        const tbody = document.getElementById('chainBody');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="21" class="loading-cell" style="color:var(--accent-red)">
                ❌ Error: ${msg}<br><small style="color:var(--text-muted)">Make sure the server is running and try again.</small>
            </td></tr>`;
        }
    }
};

// Start the app
document.addEventListener('DOMContentLoaded', () => App.init());
