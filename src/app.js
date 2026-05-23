const express = require('express');
const cors = require('cors');
const { ingestCSV } = require('./services/ingestionService');
const { runMatchingEngine } = require('./services/matchingEngine');
const ReconciliationRun = require('./models/ReconciliationRun');
const ReconciliationResult = require('./models/ReconciliationResult');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Helper function to serialize reconciliation results to CSV format
function convertResultsToCSV(results) {
  const headers = [
    'category',
    'reason',
    'user_transaction_id',
    'user_timestamp',
    'user_type',
    'user_asset',
    'user_quantity',
    'user_price_usd',
    'user_fee',
    'user_note',
    'exchange_transaction_id',
    'exchange_timestamp',
    'exchange_type',
    'exchange_asset',
    'exchange_quantity',
    'exchange_price_usd',
    'exchange_fee',
    'exchange_note'
  ];

  const escapeCSV = (val) => {
    if (val === null || val === undefined) return '';
    let str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      str = str.replace(/"/g, '""');
      return `"${str}"`;
    }
    return str;
  };

  const rows = [headers.join(',')];

  for (const r of results) {
    const u = r.userTransaction || {};
    const e = r.exchangeTransaction || {};

    const row = [
      escapeCSV(r.category),
      escapeCSV(r.reason),
      escapeCSV(u.transactionId),
      escapeCSV(u.rawTimestamp || (u.timestamp ? u.timestamp.toISOString() : '')),
      escapeCSV(u.type),
      escapeCSV(u.asset),
      escapeCSV(u.rawQuantity || u.quantity),
      escapeCSV(u.rawPriceUsd || u.priceUsd),
      escapeCSV(u.rawFee || u.fee),
      escapeCSV(u.note),
      escapeCSV(e.transactionId),
      escapeCSV(e.rawTimestamp || (e.timestamp ? e.timestamp.toISOString() : '')),
      escapeCSV(e.type),
      escapeCSV(e.asset),
      escapeCSV(e.rawQuantity || e.quantity),
      escapeCSV(e.rawPriceUsd || e.priceUsd),
      escapeCSV(e.rawFee || e.fee),
      escapeCSV(e.note)
    ];

    rows.push(row.join(','));
  }

  return rows.join('\n');
}

/**
 * POST /reconcile
 * Triggers a reconciliation run.
 */
app.post('/reconcile', async (req, res) => {
  const runId = `run_${Date.now()}`;
  
  // Get file paths and tolerance overrides
  const userFilePath = req.body.userFilePath || 'D:\\Downloads\\user_transactions.csv';
  const exchangeFilePath = req.body.exchangeFilePath || 'D:\\Downloads\\exchange_transactions.csv';
  const timestampToleranceSeconds = req.body.timestampToleranceSeconds || process.env.TIMESTAMP_TOLERANCE_SECONDS || 300;
  const quantityTolerancePct = req.body.quantityTolerancePct || process.env.QUANTITY_TOLERANCE_PCT || 0.01;

  console.log(`Received reconciliation request. Run ID: ${runId}`);

  // Create running execution record
  const runRecord = new ReconciliationRun({
    runId,
    config: {
      timestampToleranceSeconds: Number(timestampToleranceSeconds),
      quantityTolerancePct: Number(quantityTolerancePct)
    },
    status: 'running'
  });
  await runRecord.save();

  try {
    // 1. Ingest both CSVs
    console.log(`Ingesting User CSV: ${userFilePath}`);
    await ingestCSV(userFilePath, 'user', runId);

    console.log(`Ingesting Exchange CSV: ${exchangeFilePath}`);
    await ingestCSV(exchangeFilePath, 'exchange', runId);

    // 2. Run the matching algorithm
    const summary = await runMatchingEngine(runId, {
      timestampToleranceSeconds,
      quantityTolerancePct
    });

    res.status(200).json({
      success: true,
      runId,
      summary
    });
  } catch (err) {
    console.error(`Error during reconciliation run ${runId}:`, err);
    
    // Mark run as failed
    runRecord.status = 'failed';
    runRecord.error = err.message;
    await runRecord.save();

    res.status(500).json({
      success: false,
      runId,
      error: err.message
    });
  }
});

/**
 * GET /report/:runId
 * Fetches the full reconciliation report for a run (CSV by default, JSON supported).
 */
app.get('/report/:runId', async (req, res) => {
  const { runId } = req.params;
  const format = req.query.format || 'csv';

  try {
    const run = await ReconciliationRun.findOne({ runId });
    if (!run) {
      return res.status(404).json({ error: `Reconciliation run ${runId} not found` });
    }

    if (run.status !== 'completed') {
      return res.status(400).json({ error: `Reconciliation run is in status: ${run.status}` });
    }

    // Retrieve and populate matching entries
    const results = await ReconciliationResult.find({ runId })
      .populate('userTransaction')
      .populate('exchangeTransaction');

    if (format.toLowerCase() === 'json') {
      return res.status(200).json(results);
    }

    // Default to CSV
    const csvContent = convertResultsToCSV(results);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=reconciliation_report_${runId}.csv`);
    return res.status(200).send(csvContent);

  } catch (err) {
    console.error(`Error fetching report for ${runId}:`, err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /report/:runId/summary
 * Fetch just counts: matched, conflicting, unmatched.
 */
app.get('/report/:runId/summary', async (req, res) => {
  const { runId } = req.params;

  try {
    const run = await ReconciliationRun.findOne({ runId });
    if (!run) {
      return res.status(404).json({ error: `Reconciliation run ${runId} not found` });
    }

    return res.status(200).json({
      runId: run.runId,
      status: run.status,
      createdAt: run.createdAt,
      config: run.config,
      counts: {
        matched: run.summary.matched,
        conflicting: run.summary.conflicting,
        unmatchedUser: run.summary.unmatchedUser,
        unmatchedExchange: run.summary.unmatchedExchange,
        invalidRowsUser: run.summary.invalidRowsUser,
        invalidRowsExchange: run.summary.invalidRowsExchange
      }
    });

  } catch (err) {
    console.error(`Error fetching summary for ${runId}:`, err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /report/:runId/unmatched
 * Fetch only unmatched rows with reasons.
 */
app.get('/report/:runId/unmatched', async (req, res) => {
  const { runId } = req.params;

  try {
    const run = await ReconciliationRun.findOne({ runId });
    if (!run) {
      return res.status(404).json({ error: `Reconciliation run ${runId} not found` });
    }

    // Retrieve only unmatched entries (User only or Exchange only)
    const unmatchedResults = await ReconciliationResult.find({
      runId,
      category: { $in: ['Unmatched (User only)', 'Unmatched (Exchange only)'] }
    })
    .populate('userTransaction')
    .populate('exchangeTransaction');

    const formattedUnmatched = unmatchedResults.map(r => {
      const isUser = r.category === 'Unmatched (User only)';
      const tx = isUser ? r.userTransaction : r.exchangeTransaction;
      return {
        category: r.category,
        reason: r.reason,
        transaction: tx
      };
    });

    return res.status(200).json(formattedUnmatched);

  } catch (err) {
    console.error(`Error fetching unmatched rows for ${runId}:`, err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = app;
