const https = require('https');
const fs = require('fs');
const csv = require('csv-parser');
const db = require('./db');

function getBusinessDates(daysBack) {
    const dates = [];
    let d = new Date();
    while (dates.length < daysBack) {
        if (d.getDay() !== 0 && d.getDay() !== 6) { // Skip weekends
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const yyyy = d.getFullYear();
            dates.push({ dateStr: `${dd}${mm}${yyyy}`, dateObj: new Date(d) });
        }
        d.setDate(d.getDate() - 1);
    }
    return dates;
}

function downloadBhavcopy(dateInfo) {
    return new Promise((resolve, reject) => {
        const url = `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${dateInfo.dateStr}.csv`;
        const dest = `./bhavcopy_${dateInfo.dateStr}.csv`;
        
        console.log(`Downloading ${url}...`);
        
        https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            if (res.statusCode === 200) {
                const file = fs.createWriteStream(dest);
                res.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve(dest);
                });
            } else if (res.statusCode === 404 || res.statusCode === 403) {
                // Market holiday or data missing
                console.log(`Skipping ${dateInfo.dateStr} - No data (Status ${res.statusCode})`);
                resolve(null);
            } else {
                reject(new Error(`Failed to download ${url}: ${res.statusCode}`));
            }
        }).on('error', (err) => {
            reject(err);
        });
    });
}

async function processFile(filePath, dateObj) {
    return new Promise((resolve, reject) => {
        const isoDate = dateObj.toISOString().split('T')[0];
        const rows = [];
        
        fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (data) => {
                // Clean keys because CSV might have spaces
                const cleanData = {};
                for (let key in data) {
                    cleanData[key.trim()] = data[key].trim();
                }
                
                if (cleanData['SERIES'] === 'EQ') {
                    rows.push({
                        symbol: cleanData['SYMBOL'],
                        date: isoDate,
                        closePrice: parseFloat(cleanData['CLOSE_PRICE']),
                        volume: parseInt(cleanData['TTL_TRD_QNTY']),
                        deliveryVolume: parseInt(cleanData['DELIV_QTY']),
                        deliveryPercentage: parseFloat(cleanData['DELIV_PER'])
                    });
                }
            })
            .on('end', () => {
                console.log(`Parsed ${rows.length} rows for ${isoDate}`);
                db.serialize(() => {
                    db.run("BEGIN TRANSACTION");
                    const stmt = db.prepare(`
                        INSERT OR IGNORE INTO historical_delivery 
                        (symbol, date, closePrice, volume, deliveryVolume, deliveryPercentage) 
                        VALUES (?, ?, ?, ?, ?, ?)
                    `);
                    
                    rows.forEach(row => {
                        // Some stocks might not have delivery data, DELIV_PER could be '-'
                        if (!isNaN(row.deliveryPercentage)) {
                            stmt.run(row.symbol, row.date, row.closePrice, row.volume, row.deliveryVolume, row.deliveryPercentage);
                        }
                    });
                    
                    stmt.finalize();
                    db.run("COMMIT", () => {
                        console.log(`Inserted data for ${isoDate}`);
                        // Small timeout to allow Windows to release the file handle
                        setTimeout(() => {
                            try {
                                if (fs.existsSync(filePath)) {
                                    fs.unlinkSync(filePath);
                                }
                            } catch (e) {
                                console.log(`Could not delete ${filePath} immediately (file locked), skipping cleanup.`);
                            }
                        }, 500);
                        resolve();
                    });
                });
            })
            .on('error', reject);
    });
}

async function main() {
    console.log("Starting Bhavcopy synchronization for the last 30 business days...");
    const dates = getBusinessDates(30);
    
    for (const dateInfo of dates) {
        try {
            const filePath = await downloadBhavcopy(dateInfo);
            if (filePath) {
                await processFile(filePath, dateInfo.dateObj);
            }
        } catch (err) {
            console.error(`Error processing ${dateInfo.dateStr}:`, err.message);
        }
    }
    
    console.log("Sync complete!");
}

main();
