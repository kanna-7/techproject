const Transaction = require('../models/Transaction');
const ReconciliationRun = require('../models/ReconciliationRun');
const ReconciliationResult = require('../models/ReconciliationResult');

/**
 * Normalizes asset names to uppercase and resolves aliases.
 */
function normalizeAsset(asset) {
  if (!asset) return '';
  const upper = asset.toUpperCase().trim();
  if (upper === 'BITCOIN') return 'BTC';
  if (upper === 'ETHER' || upper === 'ETHEREUM') return 'ETH';
  return upper;
}

/**
 * Maps and checks type equivalence between user and exchange types.
 */
function typesMatch(userType, exchangeType) {
  const u = (userType || '').toUpperCase().trim();
  const e = (exchangeType || '').toUpperCase().trim();
  if (u === e) return true;
  if (u === 'TRANSFER_OUT' && e === 'TRANSFER_IN') return true;
  if (u === 'TRANSFER_IN' && e === 'TRANSFER_OUT') return true;
  return false;
}

/**
 * Runs the matching engine for a specific runId.
 */
async function runMatchingEngine(runId, configOverrides = {}) {
  // Fetch tolerances
  const timestampToleranceSeconds = Number(configOverrides.timestampToleranceSeconds || process.env.TIMESTAMP_TOLERANCE_SECONDS || 300);
  const quantityTolerancePct = Number(configOverrides.quantityTolerancePct || process.env.QUANTITY_TOLERANCE_PCT || 0.01);

  console.log(`Starting matching engine for Run: ${runId}`);
  console.log(`Tolerances: Timestamp = ${timestampToleranceSeconds}s, Quantity = ${quantityTolerancePct}%`);

  // Fetch all transactions for the run
  const allTransactions = await Transaction.find({ runId });

  // Separate valid and invalid
  const userTransactions = allTransactions.filter(tx => tx.source === 'user');
  const exchangeTransactions = allTransactions.filter(tx => tx.source === 'exchange');

  const userValid = userTransactions.filter(tx => tx.isValid);
  const userInvalid = userTransactions.filter(tx => !tx.isValid);
  const exchangeValid = exchangeTransactions.filter(tx => tx.isValid);
  const exchangeInvalid = exchangeTransactions.filter(tx => !tx.isValid);

  const resultsToSave = [];
  const matchedUserIds = new Set();
  const matchedExchangeIds = new Set();

  // 1. Process Invalid Transactions immediately as Unmatched
  for (const tx of userInvalid) {
    resultsToSave.push({
      runId,
      category: 'Unmatched (User only)',
      reason: `Invalid data: ${tx.validationError}`,
      userTransaction: tx._id,
      exchangeTransaction: null
    });
  }

  for (const tx of exchangeInvalid) {
    resultsToSave.push({
      runId,
      category: 'Unmatched (Exchange only)',
      reason: `Invalid data: ${tx.validationError}`,
      userTransaction: null,
      exchangeTransaction: tx._id
    });
  }

  // 2. Group Valid Transactions by Normalized Asset
  const userByAsset = {};
  const exchangeByAsset = {};

  for (const tx of userValid) {
    const asset = normalizeAsset(tx.asset);
    if (!userByAsset[asset]) userByAsset[asset] = [];
    userByAsset[asset].push(tx);
  }

  for (const tx of exchangeValid) {
    const asset = normalizeAsset(tx.asset);
    if (!exchangeByAsset[asset]) exchangeByAsset[asset] = [];
    exchangeByAsset[asset].push(tx);
  }

  // All unique assets in either source
  const assets = new Set([...Object.keys(userByAsset), ...Object.keys(exchangeByAsset)]);

  for (const asset of assets) {
    const uList = userByAsset[asset] || [];
    const eList = exchangeByAsset[asset] || [];

    // --- PASS 1: Perfect Matches ---
    for (const u of uList) {
      let bestCandidate = null;
      let minTimeDiff = Infinity;

      for (const e of eList) {
        if (matchedExchangeIds.has(e._id.toString())) continue;

        // Check type
        if (!typesMatch(u.type, e.type)) continue;

        // Check timestamp tolerance
        const timeDiffMs = Math.abs(u.timestamp.getTime() - e.timestamp.getTime());
        const timeDiffSec = timeDiffMs / 1000;
        if (timeDiffSec > timestampToleranceSeconds) continue;

        // Check quantity tolerance
        // Qty tolerance is a percentage (e.g. 0.01% -> ratio 0.0001)
        const qtyDiff = Math.abs(u.quantity - e.quantity);
        const qtyDiffPct = (qtyDiff / u.quantity) * 100;
        if (qtyDiffPct > quantityTolerancePct) continue;

        // Select the one with the closest timestamp
        if (timeDiffSec < minTimeDiff) {
          minTimeDiff = timeDiffSec;
          bestCandidate = e;
        }
      }

      if (bestCandidate) {
        matchedUserIds.add(u._id.toString());
        matchedExchangeIds.add(bestCandidate._id.toString());

        resultsToSave.push({
          runId,
          category: 'Matched',
          reason: 'Transactions matched successfully within tolerances',
          userTransaction: u._id,
          exchangeTransaction: bestCandidate._id
        });
      }
    }

    // --- PASS 2: Conflicting Matches ---
    // Look for proximity matches among remaining unmatched valid transactions.
    // Proximity window: 24 hours (86400 seconds)
    const PROXIMITY_WINDOW_SEC = 86400;

    for (const u of uList) {
      if (matchedUserIds.has(u._id.toString())) continue;

      let bestCandidate = null;
      let minDistance = Infinity;

      for (const e of eList) {
        if (matchedExchangeIds.has(e._id.toString())) continue;

        // Check type
        if (!typesMatch(u.type, e.type)) continue;

        // Proximity checks: either close in time or exact same quantity
        const timeDiffSec = Math.abs(u.timestamp.getTime() - e.timestamp.getTime()) / 1000;
        const qtyDiffPct = (Math.abs(u.quantity - e.quantity) / u.quantity) * 100;

        // We pair them if they are within 24 hours OR have exact same quantity (within tolerance)
        if (timeDiffSec <= PROXIMITY_WINDOW_SEC || qtyDiffPct <= quantityTolerancePct) {
          // Score based on time difference (primary) and quantity difference (secondary)
          // Score = timeDiffSec + (qtyDiffPct * 1000)
          const distance = timeDiffSec + (qtyDiffPct * 1000);
          if (distance < minDistance) {
            minDistance = distance;
            bestCandidate = e;
          }
        }
      }

      if (bestCandidate) {
        matchedUserIds.add(u._id.toString());
        matchedExchangeIds.add(bestCandidate._id.toString());

        const timeDiffSec = Math.abs(u.timestamp.getTime() - bestCandidate.timestamp.getTime()) / 1000;
        const qtyDiffPct = (Math.abs(u.quantity - bestCandidate.quantity) / u.quantity) * 100;

        let reason = '';
        const timeExceeded = timeDiffSec > timestampToleranceSeconds;
        const qtyExceeded = qtyDiffPct > quantityTolerancePct;

        if (timeExceeded && qtyExceeded) {
          reason = `Both timestamp difference (${Math.round(timeDiffSec)}s) and quantity difference (${qtyDiffPct.toFixed(4)}%) exceed tolerances`;
        } else if (timeExceeded) {
          reason = `Timestamp difference (${Math.round(timeDiffSec)}s) exceeds tolerance of ${timestampToleranceSeconds}s`;
        } else {
          reason = `Quantity difference (${qtyDiffPct.toFixed(4)}%) exceeds tolerance of ${quantityTolerancePct}%`;
        }

        resultsToSave.push({
          runId,
          category: 'Conflicting',
          reason,
          userTransaction: u._id,
          exchangeTransaction: bestCandidate._id
        });
      }
    }

    // --- PASS 3: Unmatched Valid Transactions ---
    // Any remaining user transactions in this asset group
    for (const u of uList) {
      if (!matchedUserIds.has(u._id.toString())) {
        resultsToSave.push({
          runId,
          category: 'Unmatched (User only)',
          reason: 'No matching exchange transaction found within proximity',
          userTransaction: u._id,
          exchangeTransaction: null
        });
      }
    }

    // Any remaining exchange transactions in this asset group
    for (const e of eList) {
      if (!matchedExchangeIds.has(e._id.toString())) {
        resultsToSave.push({
          runId,
          category: 'Unmatched (Exchange only)',
          reason: 'No matching user transaction found within proximity',
          userTransaction: null,
          exchangeTransaction: e._id
        });
      }
    }
  }

  // Save all results
  if (resultsToSave.length > 0) {
    await ReconciliationResult.insertMany(resultsToSave);
  }

  // Calculate Summary Stats
  const summary = {
    matched: resultsToSave.filter(r => r.category === 'Matched').length,
    conflicting: resultsToSave.filter(r => r.category === 'Conflicting').length,
    unmatchedUser: resultsToSave.filter(r => r.category === 'Unmatched (User only)').length,
    unmatchedExchange: resultsToSave.filter(r => r.category === 'Unmatched (Exchange only)').length,
    invalidRowsUser: userInvalid.length,
    invalidRowsExchange: exchangeInvalid.length
  };

  // Update ReconciliationRun in DB
  await ReconciliationRun.findOneAndUpdate(
    { runId },
    { status: 'completed', summary },
    { returnDocument: 'after' }
  );

  console.log(`Reconciliation run ${runId} completed successfully!`);
  console.log(`Summary: Matched=${summary.matched}, Conflicting=${summary.conflicting}, UnmatchedUser=${summary.unmatchedUser}, UnmatchedExchange=${summary.unmatchedExchange}`);

  return summary;
}

module.exports = {
  runMatchingEngine,
  normalizeAsset,
  typesMatch
};
