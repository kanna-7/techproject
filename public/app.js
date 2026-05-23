document.addEventListener('DOMContentLoaded', () => {
  // Config elements
  const form = document.getElementById('reconcileForm');
  const userFilePath = document.getElementById('userFilePath');
  const exchangeFilePath = document.getElementById('exchangeFilePath');
  const timestampTolerance = document.getElementById('timestampToleranceSeconds');
  const timestampVal = document.getElementById('timestampVal');
  const quantityTolerance = document.getElementById('quantityTolerancePct');
  const quantityVal = document.getElementById('quantityVal');
  const runBtn = document.getElementById('runBtn');
  const runStatus = document.getElementById('runStatus');
  const downloadBtn = document.getElementById('downloadCSV');

  // Stats cards elements
  const countMatched = document.getElementById('countMatched');
  const countConflicting = document.getElementById('countConflicting');
  const countUnmatchedUser = document.getElementById('countUnmatchedUser');
  const countUnmatchedExchange = document.getElementById('countUnmatchedExchange');

  // Health log elements
  const invalidUserRows = document.getElementById('invalidUserRows');
  const invalidExchangeRows = document.getElementById('invalidExchangeRows');
  const ingestionStatus = document.getElementById('ingestionStatus');
  const validationLog = document.getElementById('validationLog');

  // Report table elements
  const tableBody = document.getElementById('reportTableBody');
  const filterBtns = document.querySelectorAll('.table-filters .filter-btn');

  // Chart object
  let reconcileChart = null;
  let activeRunId = null;
  let allReportItems = [];
  let currentFilter = 'all';

  // Toggle values on slider changes
  timestampTolerance.addEventListener('input', (e) => {
    const s = parseInt(e.target.value);
    const m = Math.floor(s / 60);
    const rs = s % 60;
    if (m > 0) {
      timestampVal.textContent = `${s}s (${m}m${rs > 0 ? ` ${rs}s` : ''})`;
    } else {
      timestampVal.textContent = `${s}s`;
    }
  });

  quantityTolerance.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    quantityVal.textContent = `${val.toFixed(3)}%`;
  });

  // Handle run submit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Set loading state
    runBtn.disabled = true;
    runBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing...';
    runStatus.textContent = 'Ingesting CSVs and running matching engine...';
    downloadBtn.disabled = true;

    try {
      const payload = {
        userFilePath: userFilePath.value.trim(),
        exchangeFilePath: exchangeFilePath.value.trim(),
        timestampToleranceSeconds: parseInt(timestampTolerance.value),
        quantityTolerancePct: parseFloat(quantityTolerance.value)
      };

      const res = await fetch('/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Server returned an error');
      }

      activeRunId = data.runId;
      console.log('Reconciliation run complete. Run ID:', activeRunId);

      // Enable download
      downloadBtn.disabled = false;
      runStatus.textContent = `Reconciliation run completed! ID: ${activeRunId}`;

      // Update stats and metrics
      updateDashboard(data.summary);
      
      // Fetch full report details for display
      await fetchReportDetails(activeRunId);

    } catch (err) {
      console.error('Run failed:', err);
      runStatus.innerHTML = `<span style="color: var(--unmatched-user)">Failed: ${err.message}</span>`;
      alert('Error running reconciliation: ' + err.message);
    } finally {
      runBtn.disabled = false;
      runBtn.innerHTML = '<i class="fa-solid fa-bolt"></i> Run Reconciliation';
    }
  });

  // Handle Export CSV Download
  downloadBtn.addEventListener('click', () => {
    if (!activeRunId) return;
    window.location.href = `/report/${activeRunId}?format=csv`;
  });

  // Handle Report filtering
  filterBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      filterBtns.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentFilter = e.target.dataset.filter;
      renderTable();
    });
  });

  // Update UI Stats Cards and Ingestion Quality Logging
  function updateDashboard(summary) {
    countMatched.textContent = summary.matched;
    countConflicting.textContent = summary.conflicting;
    countUnmatchedUser.textContent = summary.unmatchedUser;
    countUnmatchedExchange.textContent = summary.unmatchedExchange;

    invalidUserRows.textContent = summary.invalidRowsUser;
    invalidExchangeRows.textContent = summary.invalidRowsExchange;
    
    if (summary.invalidRowsUser > 0 || summary.invalidRowsExchange > 0) {
      invalidUserRows.className = 'badge bg-neutral';
      invalidUserRows.style.background = 'rgba(244, 63, 94, 0.15)';
      invalidUserRows.style.color = 'var(--unmatched-user)';
      
      ingestionStatus.textContent = 'Issues Found';
      ingestionStatus.className = 'badge bg-neutral';
      ingestionStatus.style.background = 'rgba(245, 158, 11, 0.15)';
      ingestionStatus.style.color = 'var(--conflict-color)';
    } else {
      invalidUserRows.className = 'badge bg-neutral';
      invalidUserRows.style.background = 'rgba(16, 185, 129, 0.15)';
      invalidUserRows.style.color = 'var(--matched-color)';
      
      ingestionStatus.textContent = 'Healthy';
      ingestionStatus.className = 'badge bg-neutral';
      ingestionStatus.style.background = 'rgba(16, 185, 129, 0.15)';
      ingestionStatus.style.color = 'var(--matched-color)';
    }

    // Render Pie Chart
    renderChart(summary);
  }

  // Draw Pie/Doughnut Chart
  function renderChart(summary) {
    const ctx = document.getElementById('reconcileChart').getContext('2d');
    
    // Remove placeholder
    document.getElementById('chartPlaceholder').style.display = 'none';

    if (reconcileChart) {
      reconcileChart.destroy();
    }

    reconcileChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Matched', 'Conflicting', 'Unmatched User', 'Unmatched Exchange'],
        datasets: [{
          data: [
            summary.matched,
            summary.conflicting,
            summary.unmatchedUser,
            summary.unmatchedExchange
          ],
          backgroundColor: [
            '#10b981', // green
            '#f59e0b', // orange
            '#f43f5e', // red
            '#0ea5e9'  // blue
          ],
          borderWidth: 1,
          borderColor: 'rgba(255, 255, 255, 0.05)'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: '#9ca3af',
              font: { family: 'Outfit', size: 11 }
            }
          }
        },
        cutout: '65%'
      }
    });
  }

  // Fetch Full report details from API to show in list
  async function fetchReportDetails(runId) {
    try {
      const res = await fetch(`/report/${runId}?format=json`);
      allReportItems = await res.json();
      
      // Update the ingestion quality log box
      updateValidationLog();

      // Render items table
      renderTable();
    } catch (err) {
      console.error('Error fetching report details:', err);
    }
  }

  // Populates the Ingestion Health scroll-box
  function updateValidationLog() {
    validationLog.innerHTML = '';
    
    const invalidItems = allReportItems.filter(item => 
      item.reason.startsWith('Invalid data:')
    );

    if (invalidItems.length === 0) {
      validationLog.innerHTML = '<p class="empty-log" style="color: var(--matched-color)"><i class="fa-solid fa-circle-check"></i> All CSV rows successfully validated! No ingestion anomalies found.</p>';
      return;
    }

    invalidItems.forEach(item => {
      const isUser = item.category.includes('User');
      const tx = isUser ? item.userTransaction : item.exchangeTransaction;
      const txId = tx ? (tx.transactionId || 'Unknown ID') : 'Unknown ID';
      const logRow = document.createElement('div');
      logRow.className = 'log-entry error';
      logRow.innerHTML = `[${isUser ? 'User' : 'Exchange'}] <strong>${txId}</strong> - ${item.reason}`;
      validationLog.appendChild(logRow);
    });
  }

  // Renders rows in results table
  function renderTable() {
    tableBody.innerHTML = '';

    // Filter items
    const filteredItems = allReportItems.filter(item => {
      if (currentFilter === 'all') return true;
      return item.category === currentFilter;
    });

    if (filteredItems.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="5" class="empty-table">
            <i class="fa-solid fa-magnifying-glass"></i>
            <p>No transaction items match the selected filter.</p>
          </td>
        </tr>
      `;
      return;
    }

    filteredItems.forEach(item => {
      const tr = document.createElement('tr');
      
      // Class name helper
      let rowClass = 'row-matched';
      let badgeClass = 'badge-matched';
      if (item.category === 'Conflicting') {
        rowClass = 'row-conflicting';
        badgeClass = 'badge-conflicting';
      } else if (item.category === 'Unmatched (User only)') {
        rowClass = 'row-unmatched-user';
        badgeClass = 'badge-unmatched-user';
      } else if (item.category === 'Unmatched (Exchange only)') {
        rowClass = 'row-unmatched-exchange';
        badgeClass = 'badge-unmatched-exchange';
      }

      tr.className = rowClass;

      // Extract asset name
      const u = item.userTransaction || {};
      const e = item.exchangeTransaction || {};
      const asset = u.asset || e.asset || 'N/A';

      // User Tx Cell info
      let userTxHtml = '<span class="text-secondary">-</span>';
      if (item.userTransaction) {
        userTxHtml = `
          <span class="tx-id">${u.transactionId}</span>
          <span class="tx-meta">
            ${u.type} | ${u.quantity} ${u.asset}<br>
            <span class="tx-note">${u.note ? `"${u.note}"` : ''}</span>
          </span>
        `;
      }

      // Exchange Tx Cell info
      let exchangeTxHtml = '<span class="text-secondary">-</span>';
      if (item.exchangeTransaction) {
        exchangeTxHtml = `
          <span class="tx-id">${e.transactionId}</span>
          <span class="tx-meta">
            ${e.type} | ${e.quantity} ${e.asset}<br>
            <span class="tx-note">${e.note ? `"${e.note}"` : ''}</span>
          </span>
        `;
      }

      tr.innerHTML = `
        <td><span class="status-badge ${badgeClass}">${item.category}</span></td>
        <td><strong>${asset}</strong></td>
        <td>${userTxHtml}</td>
        <td>${exchangeTxHtml}</td>
        <td class="explanation-cell">${item.reason}</td>
      `;

      tableBody.appendChild(tr);
    });
  }

});
