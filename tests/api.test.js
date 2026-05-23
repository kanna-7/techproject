const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../src/app');
const ReconciliationRun = require('../src/models/ReconciliationRun');
const Transaction = require('../src/models/Transaction');
const ReconciliationResult = require('../src/models/ReconciliationResult');

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://vithanalapraveen069_db_user:5gZDA0kaUIivfhQS@cluster0.ey1bvft.mongodb.net/crypto-reconcile';

let testRunId = null;

beforeAll(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(MONGO_URI);
  }
});

afterAll(async () => {
  // Clean up test collections if needed, or just close connection
  if (testRunId) {
    await Transaction.deleteMany({ runId: testRunId });
    await ReconciliationResult.deleteMany({ runId: testRunId });
    await ReconciliationRun.deleteOne({ runId: testRunId });
  }
  await mongoose.connection.close();
});

describe('Transaction Reconciliation API Endpoints', () => {
  
  test('POST /reconcile should run reconciliation and return summary', async () => {
    const res = await request(app)
      .post('/reconcile')
      .send({
        userFilePath: 'D:\\Downloads\\user_transactions.csv',
        exchangeFilePath: 'D:\\Downloads\\exchange_transactions.csv',
        timestampToleranceSeconds: 300,
        quantityTolerancePct: 0.01
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.runId).toBeDefined();
    expect(res.body.summary).toBeDefined();
    expect(res.body.summary.matched).toBe(21);
    expect(res.body.summary.conflicting).toBe(1);
    expect(res.body.summary.unmatchedUser).toBe(4);
    expect(res.body.summary.unmatchedExchange).toBe(3);

    testRunId = res.body.runId;
  });

  test('GET /report/:runId should return CSV report by default', async () => {
    const res = await request(app)
      .get(`/report/${testRunId}`);

    expect(res.status).toBe(200);
    expect(res.header['content-type']).toContain('text/csv');
    expect(res.text).toContain('category,reason,user_transaction_id');
    expect(res.text).toContain('Matched');
    expect(res.text).toContain('Conflicting');
    expect(res.text).toContain('Unmatched (User only)');
    expect(res.text).toContain('Unmatched (Exchange only)');
  });

  test('GET /report/:runId?format=json should return JSON report', async () => {
    const res = await request(app)
      .get(`/report/${testRunId}`)
      .query({ format: 'json' });

    expect(res.status).toBe(200);
    expect(res.header['content-type']).toContain('application/json');
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty('category');
    expect(res.body[0]).toHaveProperty('reason');
  });

  test('GET /report/:runId/summary should return correct counts', async () => {
    const res = await request(app)
      .get(`/report/${testRunId}/summary`);

    expect(res.status).toBe(200);
    expect(res.body.runId).toBe(testRunId);
    expect(res.body.counts.matched).toBe(21);
    expect(res.body.counts.conflicting).toBe(1);
    expect(res.body.counts.unmatchedUser).toBe(4);
    expect(res.body.counts.unmatchedExchange).toBe(3);
  });

  test('GET /report/:runId/unmatched should return only unmatched entries', async () => {
    const res = await request(app)
      .get(`/report/${testRunId}/unmatched`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Unmatched user (4) + unmatched exchange (3) = 7 unmatched results
    expect(res.body.length).toBe(7);
    
    // Check categories are correct
    res.body.forEach(item => {
      expect(['Unmatched (User only)', 'Unmatched (Exchange only)']).toContain(item.category);
      expect(item).toHaveProperty('reason');
      expect(item).toHaveProperty('transaction');
    });
  });

  test('GET /report/invalid-run-id should return 404', async () => {
    const res = await request(app)
      .get('/report/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});
