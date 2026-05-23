const fs = require('fs');
const csv = require('csv-parser');
const Transaction = require('../models/Transaction');

/**
 * Validates a single transaction row.
 * Returns an object with { isValid, validationError, parsedValues }
 */
function validateRow(row, seenIds) {
  const transactionId = (row.transaction_id || '').trim();
  const rawTimestamp = row.timestamp || '';
  const rawType = row.type || '';
  const rawAsset = row.asset || '';
  const rawQuantity = row.quantity || '';
  const rawPriceUsd = row.price_usd || '';
  const rawFee = row.fee || '';
  const note = row.note || '';

  const errors = [];
  const parsed = {
    transactionId,
    rawTimestamp,
    type: rawType.trim(),
    asset: rawAsset.trim(),
    rawQuantity,
    rawPriceUsd,
    rawFee,
    note: note.trim(),
    timestamp: null,
    quantity: null,
    priceUsd: null,
    fee: null
  };

  // 1. Transaction ID check
  if (!transactionId) {
    errors.push('Missing transaction_id');
  } else if (seenIds.has(transactionId)) {
    errors.push(`Duplicate transaction_id: ${transactionId}`);
  }

  // 2. Timestamp check
  if (!rawTimestamp.trim()) {
    errors.push('Missing timestamp');
  } else {
    const timestampMs = Date.parse(rawTimestamp.trim());
    if (isNaN(timestampMs) || rawTimestamp.trim().endsWith('T')) {
      errors.push(`Malformed timestamp: "${rawTimestamp}"`);
    } else {
      parsed.timestamp = new Date(timestampMs);
    }
  }

  // 3. Type check
  if (!rawType.trim()) {
    errors.push('Missing type');
  }

  // 4. Asset check
  if (!rawAsset.trim()) {
    errors.push('Missing asset');
  }

  // 5. Quantity check
  if (!rawQuantity.trim()) {
    errors.push('Missing quantity');
  } else {
    const qty = parseFloat(rawQuantity);
    if (isNaN(qty)) {
      errors.push(`Malformed quantity: "${rawQuantity}"`);
    } else if (qty <= 0) {
      errors.push(`Negative or zero quantity: ${qty}`);
    } else {
      parsed.quantity = qty;
    }
  }

  // 6. Price USD check (optional, but parse if present)
  if (rawPriceUsd.trim()) {
    const price = parseFloat(rawPriceUsd);
    if (!isNaN(price)) {
      parsed.priceUsd = price;
    }
  }

  // 7. Fee check (optional, but parse if present)
  if (rawFee.trim()) {
    const feeVal = parseFloat(rawFee);
    if (!isNaN(feeVal)) {
      parsed.fee = feeVal;
    }
  }

  if (errors.length > 0) {
    return {
      isValid: false,
      validationError: errors.join(', '),
      parsedValues: parsed
    };
  }

  return {
    isValid: true,
    validationError: null,
    parsedValues: parsed
  };
}

/**
 * Ingests a CSV file for a given source and runId.
 * Saves all rows to the DB and returns stats.
 */
async function ingestCSV(filePath, source, runId) {
  return new Promise((resolve, reject) => {
    const results = [];
    const seenIds = new Set();
    let rowCount = 0;
    let validCount = 0;
    let invalidCount = 0;

    if (!fs.existsSync(filePath)) {
      return reject(new Error(`File not found: ${filePath}`));
    }

    fs.createReadStream(filePath)
      .pipe(csv())
      .on('data', (row) => {
        rowCount++;
        const { isValid, validationError, parsedValues } = validateRow(row, seenIds);
        
        // Track seen IDs for duplicate check
        if (parsedValues.transactionId && isValid) {
          seenIds.add(parsedValues.transactionId);
        }

        if (isValid) {
          validCount++;
        } else {
          invalidCount++;
          // Still track seen ID if it exists so we capture all subsequent duplicates
          if (parsedValues.transactionId) {
            seenIds.add(parsedValues.transactionId);
          }
        }

        results.push({
          runId,
          source,
          ...parsedValues,
          isValid,
          validationError
        });
      })
      .on('end', async () => {
        try {
          if (results.length > 0) {
            await Transaction.insertMany(results);
          }
          console.log(`Ingested ${rowCount} rows for ${source} (Run: ${runId}). Valid: ${validCount}, Invalid: ${invalidCount}`);
          resolve({
            total: rowCount,
            valid: validCount,
            invalid: invalidCount
          });
        } catch (err) {
          reject(err);
        }
      })
      .on('error', (err) => {
        reject(err);
      });
  });
}

module.exports = {
  ingestCSV,
  validateRow
};
