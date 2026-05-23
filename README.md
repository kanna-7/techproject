# Crypto Transaction Reconciliation Engine 🪙🔍

A robust, premium Node.js transaction reconciliation engine designed to ingest transaction CSVs (User transactions vs. Exchange transactions) into MongoDB, pair transactions using a multi-pass matching engine with configurable tolerances, and provide detailed REST API endpoints, CSV/JSON reports, and a beautiful dark-mode web dashboard.

---

## 🚀 Key Features

*   **Ingestion & Schema Validation**: Robust stream parsing of large CSVs with non-blocking record validation.
*   **Dual-Pass Matching Engine**: Matches transactions using configurable timestamp and quantity tolerances.
*   **Proximity Conflict Detection**: Smart grouping of unmatched entries within proximity to detect and detail discrepancies rather than leaving them completely unassociated.
*   **REST API**: Express endpoints for triggering runs, getting summary stats, exporting raw reports, and extracting unmatched entries.
*   **Interactive Dark-Mode Dashboard**: A modern, sleek browser interface to run reconciliations and visualize matching results in real-time.
*   **Comprehensive Testing**: Jest & Supertest suite covering unit rules, validation parsing, and full end-to-end API integration tests.

---

## 💡 Key Architectural & Design Decisions

To address ambiguous requirements in the assignment, several key engineering decisions were made:

### 1. Multi-Pass Matching & Proximity Conflict Pairing
*   **Challenge**: Real-world exchange feeds and user ledgers often deviate slightly in timestamp (network propagation) or quantity (rounding/fees). Simply classifying transactions as matched or unmatched leaves users without insights into *why* they didn't match.
*   **Decision**: A **dual-pass matching engine** was designed:
    *   **Pass 1 (Perfect Matches)**: Pairs records of the same asset and matching types where differences are strictly within the allowed timestamp and quantity tolerances.
    *   **Pass 2 (Conflicting Matches)**: Searches remaining unmatched items within a **24-hour proximity window** (or those with exact quantity matches). It pairs them and marks them as **"Conflicting"**, generating a highly descriptive reason (e.g., `Timestamp difference (452s) exceeds tolerance of 300s`) indicating exactly which threshold was breached.
    *   **Pass 3 (Unmatched)**: Anything remaining is marked as `Unmatched (User only)` or `Unmatched (Exchange only)`.

### 2. Ingestion-Level Integrity & Non-Blocking Validation
*   **Challenge**: Malformed data should not crash or abort a massive reconciliation run. However, blindly discarding invalid rows makes audits impossible.
*   **Decision**: Invalid rows (e.g., negative quantities, missing timestamps, duplicate transaction IDs) are still saved in MongoDB but flagged with `isValid: false` and a `validationError` string. The matching engine automatically bypasses them from core pairing logic and publishes them directly to the final report categorized as `Unmatched` with the validation failure reason.

### 3. Dynamic Tolerance Configurations
*   **Challenge**: Fixed environment-only variables are rigid and prevent users from running reconciliations with custom tolerances on-the-fly.
*   **Decision**: Tolerances are fully customizable. The engine evaluates configuration in a prioritized cascade:
    1.  Request-level body overrides in `POST /reconcile` (e.g., `timestampToleranceSeconds`, `quantityTolerancePct`).
    2.  Environment variables from `.env`.
    3.  Engine fallback defaults (e.g., 300 seconds and 0.01% quantity tolerance).

### 4. Run-Based Ledger Storage (Multi-Tenancy)
*   **Challenge**: Rebuilding or overwriting a single collection for every run makes it impossible to view past results or handle concurrent workflows.
*   **Decision**: Every execution generates a unique `runId` (e.g., `run_171644...`). All parsed transactions and reconciliation outcomes are tagged with this `runId` and indexed. This maintains complete execution history and audit trails.

### 5. Smart Normalization & Type Equivalence
*   **Challenge**: Users specify assets in varying cases (e.g., `btc`, `BTC`, `bitcoin`), and transfer types might cross paths (e.g., sending out of a user wallet is a transfer-out, but shows as transfer-in on the exchange).
*   **Decision**:
    *   **Asset Normalization**: Automatically converts asset names to uppercase and resolves aliases (e.g., `bitcoin` -> `BTC`, `ether`/`ethereum` -> `ETH`).
    *   **Type Mapping**: Normalizes type cases and establishes equivalence for transfers (`TRANSFER_OUT` in user ledger matches `TRANSFER_IN` in exchange ledger and vice-versa).

---

## 🛠️ Technology Stack

*   **Runtime**: Node.js (v16+)
*   **Framework**: Express.js
*   **Database**: MongoDB (via Mongoose)
*   **CSV Parsing**: `csv-parser` (Event-driven stream reading)
*   **Testing**: Jest & Supertest
*   **Frontend**: Vanilla HTML5, CSS3 (Modern HSL styling & dark-theme variables), and JavaScript

---

## ⚙️ Setup & Installation

### 1. Prerequisites
Make sure you have the following installed:
*   [Node.js](https://nodejs.org/) (v18 or higher recommended)
*   [MongoDB](https://www.mongodb.com/try/download/community) (either a local instance or a MongoDB Atlas connection string)

### 2. Clone the Repository
```bash
git clone https://github.com/kanna-7/techproject.git
cd techproject
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Configure Environment Variables
Create a `.env` file in the root directory by copying the example:
```bash
cp .env.example .env
```
Open `.env` and fill in your details:
```env
PORT=3000
MONGO_URI=your_mongodb_connection_string
TIMESTAMP_TOLERANCE_SECONDS=300
QUANTITY_TOLERANCE_PCT=0.01
```

---

## 🏃 Running the Application

### Start the Server
To run the server in production/regular mode:
```bash
npm start
```
Upon a successful connection, you will see:
```text
Connecting to MongoDB cluster...
Successfully connected to MongoDB Cluster!
Transaction Reconciliation Server is running on port 3000
```

### Access the Web Dashboard
Open your browser and navigate to:
```text
http://localhost:3000
```
This loads a premium, dark-mode user interface where you can:
1. Trigger a new reconciliation run by specifying CSV absolute paths.
2. View real-time matching stats (Matched, Conflicting, Unmatched, Invalid counts).
3. Visualize full reports in structured tables.
4. Export CSV reports with a single click.

---

## 🧪 Running Tests

The test suite includes robust unit testing for matching algorithms and validation, plus integration testing for API endpoints.

To run the tests:
```bash
npm test
```

---

## 📡 REST API Reference

### 1. Trigger Reconciliation Run
*   **Endpoint**: `POST /reconcile`
*   **Content-Type**: `application/json`
*   **Payload**:
    ```json
    {
      "userFilePath": "C:\\path\\to\\user_transactions.csv",
      "exchangeFilePath": "C:\\path\\to\\exchange_transactions.csv",
      "timestampToleranceSeconds": 300,
      "quantityTolerancePct": 0.01
    }
    ```
*   **Response**:
    ```json
    {
      "success": true,
      "runId": "run_1716441234567",
      "summary": {
        "matched": 21,
        "conflicting": 1,
        "unmatchedUser": 4,
        "unmatchedExchange": 3,
        "invalidRowsUser": 0,
        "invalidRowsExchange": 0
      }
    }
    ```

### 2. Export Reconciliation Report
*   **Endpoint**: `GET /report/:runId`
*   **Query Parameters**: `format=csv` (default) or `format=json`
*   **Response**: 
    *   For CSV: File attachment download containing all aligned rows with their category and reason.
    *   For JSON: Array of fully populated matching results with nested transaction objects.

### 3. Get Run Summary Counts
*   **Endpoint**: `GET /report/:runId/summary`
*   **Response**:
    ```json
    {
      "runId": "run_1716441234567",
      "status": "completed",
      "createdAt": "2026-05-23T04:47:00.000Z",
      "config": {
        "timestampToleranceSeconds": 300,
        "quantityTolerancePct": 0.01
      },
      "counts": {
        "matched": 21,
        "conflicting": 1,
        "unmatchedUser": 4,
        "unmatchedExchange": 3,
        "invalidRowsUser": 0,
        "invalidRowsExchange": 0
      }
    }
    ```

### 4. Fetch Unmatched Rows Details
*   **Endpoint**: `GET /report/:runId/unmatched`
*   **Response**: Returns an array of only unmatched and invalid transactions from both sources with specific failure and rejection explanations.

---

## 📂 Project Directory Structure

```text
techproject/
├── public/                 # Static web dashboard resources
│   ├── index.html          # Sleek HTML dashboard structure
│   ├── style.css           # Custom dark theme modern CSS
│   └── app.js              # Interactive client-side fetch logic
├── src/
│   ├── models/             # Mongoose Database Schemas
│   │   ├── Transaction.js          # Ingested user/exchange rows
│   │   ├── ReconciliationRun.js    # Run configuration and summary stats
│   │   └── ReconciliationResult.js # final aligned paired reports
│   ├── services/           # Core Engine Logic
│   │   ├── ingestionService.js     # Non-blocking stream CSV parser
│   │   └── matchingEngine.js       # Aligner, normalizer, and matching rules
│   ├── app.js              # Express app endpoints and configurations
│   └── server.js           # Server database connection & entry point
├── tests/                  # Automated Test Suite
│   ├── api.test.js         # Endpoint testing (Supertest)
│   └── matchingEngine.test.js # Core unit testing (Jest)
├── .env.example            # Environment variables template
├── .gitignore              # Standard ignored folder rules
├── package.json            # Node dependency configuration
└── README.md               # Project documentation (this file)
```
deployment link : https://techproject-reconciler.onrender.com/
