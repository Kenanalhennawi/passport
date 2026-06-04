import { readPassport } from "./passport-reader.js";
import { readVisaDocument } from "./visa-reader.js";
import { compareDocuments } from "./compare-engine.js";

const passportInput = document.getElementById("passportInput");
const visaInput = document.getElementById("visaInput");
const passportPreview = document.getElementById("passportPreview");
const visaPreview = document.getElementById("visaPreview");
const processBtn = document.getElementById("processBtn");
const clearBtn = document.getElementById("clearBtn");

const passportDataBox = document.getElementById("passportData");
const visaDataBox = document.getElementById("visaData");
const comparisonTable = document.getElementById("comparisonTable");
const finalDecision = document.getElementById("finalDecision");
const alertsList = document.getElementById("alertsList");
const rawOutput = document.getElementById("rawOutput");
const statusPanel = document.getElementById("statusPanel");

const progressPanel = document.getElementById("progressPanel");
const progressTitle = document.getElementById("progressTitle");
const progressPercent = document.getElementById("progressPercent");
const progressBar = document.getElementById("progressBar");
const progressMessage = document.getElementById("progressMessage");

let passportFile = null;
let visaFile = null;

function initApp() {
  passportInput.addEventListener("change", () => {
    passportFile = passportInput.files[0] || null;
    showPreview(passportFile, passportPreview);
  });

  visaInput.addEventListener("change", () => {
    visaFile = visaInput.files[0] || null;
    showPreview(visaFile, visaPreview);
  });

  processBtn.addEventListener("click", () => {
    processDocuments();
  });

  clearBtn.addEventListener("click", () => {
    clearAll();
  });

  console.log("Passport verifier app initialized successfully.");
}

initApp();

window.addEventListener("error", (event) => {
  console.error("Global error:", event.error || event.message);
  showStatus(event.message || "Unexpected error occurred.", "danger");
  setBusy(false);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection:", event.reason);
  showStatus(event.reason?.message || "Processing failed unexpectedly.", "danger");
  setBusy(false);
});

function showPreview(file, imgElement) {
  if (!imgElement) return;

  if (!file) {
    imgElement.classList.add("hidden");
    imgElement.removeAttribute("src");
    return;
  }

  const reader = new FileReader();

  reader.onload = (event) => {
    imgElement.src = event.target.result;
    imgElement.classList.remove("hidden");
  };

  reader.onerror = () => {
    showStatus("Image preview failed. Please select another image.", "danger");
  };

  reader.readAsDataURL(file);
}

async function processDocuments() {
  if (!passportFile || !visaFile) {
    showStatus("Please upload both passport and visa/residence images.", "warning");
    return;
  }

  try {
    setBusy(true);
    resetProgress();
    showStatus("Processing locally. No image or personal data is uploaded.", "info");

    updateProgress(5, "Starting", "Preparing local OCR engine...");

    const passportResult = await readPassport(passportFile, (progress) => {
      const percent = 5 + Math.round(progress * 40);

      updateProgress(
        Math.min(45, percent),
        "Reading Passport",
        "Detecting MRZ and extracting passport data..."
      );
    });

    updateProgress(
      50,
      "Passport Completed",
      "Passport data extracted. Reading secondary document..."
    );

    const visaResult = await readVisaDocument(visaFile, (progress) => {
      const percent = 50 + Math.round(progress * 40);

      updateProgress(
        Math.min(90, percent),
        "Reading Visa / Residence Document",
        "Extracting document fields..."
      );
    });

    updateProgress(94, "Comparing Documents", "Running field-by-field verification...");

    const comparison = compareDocuments(passportResult.data, visaResult.data);

    renderDataTable(passportDataBox, passportResult.data);
    renderDataTable(visaDataBox, visaResult.data);
    renderComparison(comparison);
    renderDecision(comparison);
    renderAlerts(comparison.alerts);

    rawOutput.textContent = JSON.stringify(
      {
        passport: passportResult,
        visa: visaResult,
        comparison
      },
      null,
      2
    );

    updateProgress(100, "Completed", "Verification completed successfully.");
    showStatus("Processing completed successfully.", "success");
  } catch (error) {
    console.error(error);
    showStatus(error.message || "Processing failed.", "danger");
    updateProgress(
      100,
      "Failed",
      "Processing failed. Please check the image quality or console error."
    );
  } finally {
    setBusy(false);
  }
}

function updateProgress(percent, title, message) {
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));

  progressPanel.classList.remove("hidden");
  progressBar.style.width = `${safePercent}%`;
  progressPercent.textContent = `${safePercent}%`;
  progressTitle.textContent = title;
  progressMessage.textContent = message;
}

function resetProgress() {
  progressPanel.classList.remove("hidden");
  progressBar.style.width = "0%";
  progressPercent.textContent = "0%";
  progressTitle.textContent = "Processing...";
  progressMessage.textContent = "Preparing OCR engine...";
}

function renderDataTable(container, data) {
  const rows = Object.entries(data || {}).map(([key, value]) => {
    return `
      <tr>
        <td>${escapeHtml(formatLabel(key))}</td>
        <td>${escapeHtml(formatValue(value))}</td>
      </tr>
    `;
  }).join("");

  container.classList.remove("empty");
  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Field</th>
          <th>Extracted Value</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderComparison(result) {
  if (!result || !Array.isArray(result.fields)) {
    comparisonTable.classList.add("empty");
    comparisonTable.textContent = "No comparison available.";
    return;
  }

  const rows = result.fields.map((item) => `
    <tr>
      <td>${escapeHtml(item.label)}</td>
      <td>${escapeHtml(item.passportValue || "Not detected")}</td>
      <td>${escapeHtml(item.visaValue || "Not detected")}</td>
      <td><span class="badge ${escapeHtml(item.statusClass || "partial")}">${escapeHtml(item.status || "Unknown")}</span></td>
      <td>${escapeHtml(item.note || "")}</td>
    </tr>
  `).join("");

  comparisonTable.classList.remove("empty");
  comparisonTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Field</th>
          <th>Passport</th>
          <th>Visa / Residence</th>
          <th>Result</th>
          <th>Details</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function renderDecision(result) {
  if (!result) {
    finalDecision.className = "decision-box empty";
    finalDecision.textContent = "No decision available.";
    return;
  }

  let decisionClass = "decision-warning";

  if (result.decision === "VERIFIED") decisionClass = "decision-verified";
  if (result.decision === "REJECTED") decisionClass = "decision-failed";

  finalDecision.classList.remove("empty");
  finalDecision.innerHTML = `
    <div class="decision-title ${decisionClass}">${escapeHtml(result.decision || "UNKNOWN")}</div>
    <p><strong>Risk Level:</strong> ${escapeHtml(result.riskLevel || "Unknown")}</p>
    <p><strong>Overall Match Score:</strong> ${escapeHtml(result.score ?? "N/A")}%</p>
    <p><strong>Reason:</strong> ${escapeHtml(result.reason || "")}</p>
  `;
}

function renderAlerts(alerts) {
  if (!Array.isArray(alerts) || !alerts.length) {
    alertsList.innerHTML = "<li>No alerts detected.</li>";
    return;
  }

  alertsList.innerHTML = alerts.map((alert) => `<li>${escapeHtml(alert)}</li>`).join("");
}

function showStatus(message, type) {
  statusPanel.classList.remove("hidden");
  statusPanel.innerHTML = `<strong>${escapeHtml(message)}</strong>`;

  statusPanel.style.borderLeft = type === "danger"
    ? "8px solid #b42318"
    : type === "warning"
      ? "8px solid #c77700"
      : type === "success"
        ? "8px solid #138a43"
        : "8px solid #0066b3";
}

function setBusy(isBusy) {
  processBtn.disabled = isBusy;
  clearBtn.disabled = isBusy;
  processBtn.textContent = isBusy ? "Processing..." : "Read & Compare Documents";
}

function clearAll() {
  passportFile = null;
  visaFile = null;

  passportInput.value = "";
  visaInput.value = "";

  passportPreview.classList.add("hidden");
  visaPreview.classList.add("hidden");
  passportPreview.removeAttribute("src");
  visaPreview.removeAttribute("src");

  passportDataBox.className = "data-table empty";
  visaDataBox.className = "data-table empty";
  comparisonTable.className = "comparison empty";
  finalDecision.className = "decision-box empty";

  passportDataBox.textContent = "No passport processed yet.";
  visaDataBox.textContent = "No visa or residence document processed yet.";
  comparisonTable.textContent = "No comparison available yet.";
  finalDecision.textContent = "Waiting for document processing.";

  alertsList.innerHTML = "<li>No alerts yet.</li>";
  rawOutput.textContent = "No raw data yet.";

  statusPanel.classList.add("hidden");

  progressPanel.classList.add("hidden");
  progressBar.style.width = "0%";
  progressPercent.textContent = "0%";
  progressTitle.textContent = "Processing...";
  progressMessage.textContent = "Preparing OCR engine...";

  setBusy(false);
}

function formatLabel(key) {
  return String(key || "")
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (char) => char.toUpperCase());
}

function formatValue(value) {
  if (value === null || value === undefined || value === "") {
    return "Not detected";
  }

  if (Array.isArray(value)) {
    return value.length ? value.join(" | ") : "Not detected";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return value;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
