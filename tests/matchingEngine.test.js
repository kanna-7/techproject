const { normalizeAsset, typesMatch } = require('../src/services/matchingEngine');
const { validateRow } = require('../src/services/ingestionService');

describe('Matching Engine Helpers', () => {
  describe('normalizeAsset', () => {
    test('should capitalize asset names', () => {
      expect(normalizeAsset('btc')).toBe('BTC');
      expect(normalizeAsset('eth')).toBe('ETH');
    });

    test('should resolve bitcoin alias to BTC', () => {
      expect(normalizeAsset('bitcoin')).toBe('BTC');
      expect(normalizeAsset('Bitcoin')).toBe('BTC');
      expect(normalizeAsset('BITCOIN')).toBe('BTC');
    });

    test('should resolve ether aliases to ETH', () => {
      expect(normalizeAsset('ether')).toBe('ETH');
      expect(normalizeAsset('ethereum')).toBe('ETH');
    });

    test('should return empty string for null or undefined', () => {
      expect(normalizeAsset(null)).toBe('');
      expect(normalizeAsset(undefined)).toBe('');
    });
  });

  describe('typesMatch', () => {
    test('should match identical types', () => {
      expect(typesMatch('BUY', 'BUY')).toBe(true);
      expect(typesMatch('SELL', 'SELL')).toBe(true);
    });

    test('should match TRANSFER_OUT with TRANSFER_IN', () => {
      expect(typesMatch('TRANSFER_OUT', 'TRANSFER_IN')).toBe(true);
      expect(typesMatch('TRANSFER_IN', 'TRANSFER_OUT')).toBe(true);
    });

    test('should not match mismatched types', () => {
      expect(typesMatch('BUY', 'SELL')).toBe(false);
      expect(typesMatch('TRANSFER_OUT', 'BUY')).toBe(false);
    });
  });
});

describe('Ingestion Validation', () => {
  test('should validate a correct row', () => {
    const row = {
      transaction_id: 'USR-001',
      timestamp: '2024-03-01T09:00:00Z',
      type: 'BUY',
      asset: 'BTC',
      quantity: '0.5',
      price_usd: '62000.00',
      fee: '0.0005',
      note: 'Monthly DCA'
    };
    const seenIds = new Set();
    const result = validateRow(row, seenIds);
    expect(result.isValid).toBe(true);
    expect(result.validationError).toBeNull();
    expect(result.parsedValues.quantity).toBe(0.5);
    expect(result.parsedValues.priceUsd).toBe(62000.0);
  });

  test('should flag missing transaction_id', () => {
    const row = {
      transaction_id: '',
      timestamp: '2024-03-01T09:00:00Z',
      type: 'BUY',
      asset: 'BTC',
      quantity: '0.5'
    };
    const seenIds = new Set();
    const result = validateRow(row, seenIds);
    expect(result.isValid).toBe(false);
    expect(result.validationError).toContain('Missing transaction_id');
  });

  test('should flag duplicate transaction_id', () => {
    const row = {
      transaction_id: 'USR-001',
      timestamp: '2024-03-01T09:00:00Z',
      type: 'BUY',
      asset: 'BTC',
      quantity: '0.5'
    };
    const seenIds = new Set(['USR-001']);
    const result = validateRow(row, seenIds);
    expect(result.isValid).toBe(false);
    expect(result.validationError).toContain('Duplicate transaction_id');
  });

  test('should flag malformed or missing timestamp', () => {
    const rowMalformed = {
      transaction_id: 'USR-018',
      timestamp: '2024-03-09T',
      type: 'SELL',
      asset: 'ETH',
      quantity: '0.3'
    };
    const seenIds = new Set();
    const result = validateRow(rowMalformed, seenIds);
    expect(result.isValid).toBe(false);
    expect(result.validationError).toContain('Malformed timestamp');

    const rowMissing = {
      transaction_id: 'USR-024',
      timestamp: '',
      type: 'SELL',
      asset: 'ETH',
      quantity: '0.3'
    };
    const resultMissing = validateRow(rowMissing, seenIds);
    expect(resultMissing.isValid).toBe(false);
    expect(resultMissing.validationError).toContain('Missing timestamp');
  });

  test('should flag negative quantity', () => {
    const row = {
      transaction_id: 'USR-019',
      timestamp: '2024-03-10T08:00:00Z',
      type: 'BUY',
      asset: 'BTC',
      quantity: '-0.1'
    };
    const seenIds = new Set();
    const result = validateRow(row, seenIds);
    expect(result.isValid).toBe(false);
    expect(result.validationError).toContain('Negative or zero quantity');
  });
});
