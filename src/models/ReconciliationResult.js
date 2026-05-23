const mongoose = require('mongoose');

const ReconciliationResultSchema = new mongoose.Schema({
  runId: {
    type: String,
    required: true,
    index: true
  },
  category: {
    type: String,
    enum: ['Matched', 'Conflicting', 'Unmatched (User only)', 'Unmatched (Exchange only)'],
    required: true,
    index: true
  },
  reason: {
    type: String,
    required: true
  },
  userTransaction: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction',
    default: null
  },
  exchangeTransaction: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction',
    default: null
  }
}, {
  timestamps: true
});

// Help fetch report categories quickly for a run
ReconciliationResultSchema.index({ runId: 1, category: 1 });

module.exports = mongoose.model('ReconciliationResult', ReconciliationResultSchema);
