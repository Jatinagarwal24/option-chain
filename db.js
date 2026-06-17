const fs = require('fs');
const path = require('path');

const dbPath = path.resolve(__dirname, 'delivery_data.json');
let cache = null;

function load() {
    if (cache) return cache;
    if (fs.existsSync(dbPath)) {
        try {
            cache = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
            return cache;
        } catch (e) {
            console.error("Failed to parse DB JSON");
        }
    }
    cache = {};
    return cache;
}

function save() {
    if (cache) {
        fs.writeFileSync(dbPath, JSON.stringify(cache));
    }
}

function insertMany(rows) {
    const data = load();
    let updated = false;
    
    for (const r of rows) {
        if (!data[r.symbol]) data[r.symbol] = [];
        
        // Check for duplicate date
        const exists = data[r.symbol].find(x => x.date === r.date);
        if (!exists) {
            data[r.symbol].push(r);
            updated = true;
        }
    }
    
    if (updated) {
        // Ensure sorted by date
        for (const sym in data) {
            data[sym].sort((a, b) => a.date.localeCompare(b.date));
        }
        save();
    }
}

function getHistory(symbol) {
    const data = load();
    return data[symbol] || [];
}

module.exports = { insertMany, getHistory };
