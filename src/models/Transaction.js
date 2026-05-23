const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  runId: {
    type: String,
    required: true,
    index: true
  },
  source: {
    type: String,
    enum: ['user', 'exchange'],
    required: true,
    index: true
  },
  transactionId: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: null
  },
  rawTimestamp: {
    type: String,
    default: ''
  },
  type: {
    type: String,
    default: ''
  },
  asset: {
    type: String,
    default: ''
  },
  quantity: {
    type: Number,
    default: null
  },
  rawQuantity: {
    type: String,
    default: ''
  },
  priceUsd: {
    type: Number,
    default: null
  },
  rawPriceUsd: {
    type: String,
    default: ''
  },
  fee: {
    type: Number,
    default: null
  },
  rawFee: {
    type: String,
    default: ''
  },
  note: {
    type: String,
    default: ''
  },
  isValid: {
    type: Boolean,
    default: true
  },
  validationError: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Compound index to help with querying and grouping by source, asset, type inside a run
TransactionSchema.index({ runId: 1, source: 1, isValid: 1 });

module.exports = mongoose.model('Transaction', TransactionSchema);
