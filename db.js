const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'delivery_data.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS historical_delivery (
            symbol TEXT,
            date TEXT,
            closePrice REAL,
            volume INTEGER,
            deliveryVolume INTEGER,
            deliveryPercentage REAL,
            PRIMARY KEY (symbol, date)
        )
    `);
});

module.exports = db;
