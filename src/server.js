require('dotenv').config();
const mongoose = require('mongoose');
const app = require('./app');

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('FATAL ERROR: MONGO_URI is not defined in the environment variables.');
  process.exit(1);
}

console.log('Connecting to MongoDB cluster...');
mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('Successfully connected to MongoDB Cluster!');
    app.listen(PORT, () => {
      console.log(`Transaction Reconciliation Server is running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to connect to MongoDB Cluster:', err.message);
    process.exit(1);
  });
