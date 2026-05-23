const mongoose = require('mongoose');

const ReconciliationRunSchema = new mongoose.Schema({
  runId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  config: {
    timestampToleranceSeconds: {
      type: Number,
      required: true
    },
    quantityTolerancePct: {
      type: Number,
      required: true
    }
  },
  status: {
    type: String,
    enum: ['running', 'completed', 'failed'],
    default: 'running'
  },
  error: {
    type: String,
    default: null
  },
  summary: {
    matched: { type: Number, default: 0 },
    conflicting: { type: Number, default: 0 },
    unmatchedUser: { type: Number, default: 0 },
    unmatchedExchange: { type: Number, default: 0 },
    invalidRowsUser: { type: Number, default: 0 },
    invalidRowsExchange: { type: Number, default: 0 }
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('ReconciliationRun', ReconciliationRunSchema);
