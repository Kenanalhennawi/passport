// app.js
import { readPassport } from "./passport-reader.js";
import { readVisaDocument } from "./visa-reader.js";
import { compareDocuments } from "./compare-engine.js";
import {
  getPdfPageCount,
  renderPdfPageToImageDataUrl
} from "./image-processor.js";

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

const passportPageSelectorDiv = document.getElementById("passportPageSelector");
const visaPageSelectorDiv = document.getElementById("visaPageSelector");
const passportPageSelect = document.getElementById("passportPageSelect");
const visaPageSelect = document.getElementById("visaPageSelect");

const MAX_SELECTABLE_PDF_PAGES = 5;

let passportFile = null;
let visaFile = null;

let passportPreviewToken = 0;
let visaPreviewToken = 0;

function initApp() {
  passportInput.addEventListener("change", async () => {
    passportFile = passportInput.files[0] || null;
    await handleFileSelection({
      file: passportFile,
      imgElement: passportPreview,
      selectElement: passportPageSelect,
      selectorDiv: passportPageSelectorDiv,
      previewType: "passport"
    });
  });

  visaInput.addEventListener("change", async () => {
    visaFile = visaInput.files[0] || null;
    await handleFileSelection({
      file: visaFile,
      imgElement: visaPreview,
      selectElement: visaPageSelect,
      selectorDiv: visaPageSelectorDiv,
      previewType: "visa"
    });
  });

  if (passportPageSelect) {
    passportPageSelect.addEventListener("change", async () => {
      if (!passportFile) return;
      await showPreview(passportFile, passportPreview, passportPageSelect, "passport");
    });
  }

  if (visaPageSelect) {
    visaPageSelect.addEventListener("change", async () => {
      if (!visaFile) return;
      await showPreview(visaFile, visaPreview, visaPageSelect, "visa");
    });
  }

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

async function handleFileSelection({
  file,
  imgElement,
  selectElement,
  selectorDiv,
  previewType
}) {
  try {
    if (!file) {
      clearPreview(imgElement);
      hidePageSelector(selectorDiv, selectElement);
      return;
    }

    await updatePageSelector(file, selectElement, selectorDiv);
    await showPreview(file, imgElement, selectElement, previewType);
  } catch (error) {
    console.error(error);
    clearPreview(imgElement);
    hidePageSelector(selectorDiv, selectElement);
    showStatus(error.message || "File preview failed.", "danger");
  }
}

async function showPreview(file, imgElement, selectElement = null, previewType = "generic") {
  if (!imgElement) return;

  if (!file) {
    clearPreview(imgElement);
    return;
  }

  const token = incrementPreviewToken(previewType);

  imgElement.classList.remove("hidden");
  imgElement.removeAttribute("src");
  imgElement.alt = "Loading preview...";

  try {
    let previewSrc = "";

    if (isPdfFile(file)) {
      const pageNumber = getPreviewPageNumber(selectElement);
      previewSrc = await renderPdfPageToImageDataUrl(file, pageNumber, 1.8);
    } else if (isImageFile(file)) {
      previewSrc = await imageFileToDataUrl(file);
    } else {
      throw new Error("Unsupported preview file type.");
    }

    if (!isCurrentPreviewToken(previewType, token)) return;

    imgElement.src = previewSrc;
    imgElement.alt = isPdfFile(file) ? "PDF page preview" : "Image preview";
    imgElement.classList.remove("hidden");
  } catch (error) {
    if (!isCurrentPreviewToken(previewType, token)) return;

    console.error(error);
    clearPreview(imgElement);
    showStatus(error.message || "Preview failed.", "danger");
  }
}

async function updatePageSelector(file, selectElement, selectorDiv) {
  if (!selectElement || !selectorDiv) return;

  selectElement.innerHTML = "";

  if (!file || !isPdfFile(file)) {
    hidePageSelector(selectorDiv, selectElement);
    return;
  }

  const pageCount = await getPdfPageCount(file);
  const selectablePages = Math.min(pageCount, MAX_SELECTABLE_PDF_PAGES);

  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = `All pages (up to ${selectablePages})`;
  selectElement.appendChild(allOption);

  for (let page = 1; page <= selectablePages; page += 1) {
    const option = document.createElement("option");
    option.value = String(page);
    option.textContent = `Page ${page}`;
    selectElement.appendChild(option);
  }

  selectElement.dataset.pageCount = String(pageCount);
  selectElement.dataset.maxSelectablePages = String(selectablePages);
  selectorDiv.classList.remove("hidden");
}

function hidePageSelector(selectorDiv, selectElement) {
  if (selectorDiv) selectorDiv.classList.add("hidden");

  if (selectElement) {
    selectElement.innerHTML = "";
    delete selectElement.dataset.pageCount;
    delete selectElement.dataset.maxSelectablePages;
  }
}

function getPreviewPageNumber(selectElement) {
  if (!selectElement) return 1;

  const value = selectElement.value;

  if (!value || value === "all") {
    return 1;
  }

  const pageNumber = Number.parseInt(value, 10);

  return Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : 1;
}

function getSelectedPageNumbers(selectElement) {
  if (!selectElement || !selectElement.value || selectElement.value === "all") {
    return [];
  }

  const pageNumber = Number.parseInt(selectElement.value, 10);

  return Number.isFinite(pageNumber) && pageNumber > 0 ? [pageNumber] : [];
}

function isPdfFile(file) {
  return (
    file &&
    (
      file.type === "application/pdf" ||
      String(file.name || "").toLowerCase().endsWith(".pdf")
    )
  );
}

function isImageFile(file) {
  return Boolean(file && file.type && file.type.startsWith("image/"));
}

function imageFileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);

    reader.onerror = () => {
      reject(new Error("Unable to preview image file."));
    };

    reader.readAsDataURL(file);
  });
}

function clearPreview(imgElement) {
  if (!imgElement) return;

  imgElement.classList.add("hidden");
  imgElement.removeAttribute("src");
  imgElement.alt = "Preview";
}

function incrementPreviewToken(type) {
  if (type === "passport") {
    passportPreviewToken += 1;
    return passportPreviewToken;
  }

  if (type === "visa") {
    visaPreviewToken += 1;
    return visaPreviewToken;
  }

  return Date.now();
}

function isCurrentPreviewToken(type, token) {
  if (type === "passport") return token === passportPreviewToken;
  if (type === "visa") return token === visaPreviewToken;
  return true;
}

async function processDocuments() {
  if (!passportFile || !visaFile) {
    showStatus("Please upload both passport and visa/residence images.", "warning");
    return;
  }

  const passportPageNumbers = getSelectedPageNumbers(passportPageSelect);
  const visaPageNumbers = getSelectedPageNumbers(visaPageSelect);

  try {
    setBusy(true);
    resetProgress();
    showStatus("Processing locally. No image or personal data is uploaded.", "info");

    updateProgress(5, "Starting", "Preparing local OCR engine...");

    const passportResult = await readPassport(
      passportFile,
      (progress) => {
        const percent = 5 + Math.round(progress * 40);
        updateProgress(
          Math.min(45, percent),
          "Reading Passport",
          "Detecting MRZ and extracting passport data..."
        );
      },
      {
        pageNumbers: passportPageNumbers
      }
    );

    updateProgress(
      50,
      "Passport Completed",
      "Passport data extracted. Reading secondary document..."
    );

    const visaResult = await readVisaDocument(
      visaFile,
      (progress) => {
        const percent = 50 + Math.round(progress * 40);
        updateProgress(
          Math.min(90, percent),
          "Reading Visa / Residence Document",
          "Extracting document fields..."
        );
      },
      {
        pageNumbers: visaPageNumbers
      }
    );

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
      <td>
        <span class="badge ${escapeHtml(item.statusClass || "partial")}">
          ${escapeHtml(item.status || "Unknown")}
        </span>
      </td>
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
    <div class="decision-title ${decisionClass}">
      ${escapeHtml(result.decision || "UNKNOWN")}
    </div>
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

  alertsList.innerHTML = alerts
    .map((alert) => `<li>${escapeHtml(alert)}</li>`)
    .join("");
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

  if (passportInput) passportInput.disabled = isBusy;
  if (visaInput) visaInput.disabled = isBusy;
  if (passportPageSelect) passportPageSelect.disabled = isBusy;
  if (visaPageSelect) visaPageSelect.disabled = isBusy;

  processBtn.textContent = isBusy ? "Processing..." : "Read & Compare Documents";
}

function clearAll() {
  passportFile = null;
  visaFile = null;

  passportInput.value = "";
  visaInput.value = "";

  clearPreview(passportPreview);
  clearPreview(visaPreview);

  hidePageSelector(passportPageSelectorDiv, passportPageSelect);
  hidePageSelector(visaPageSelectorDiv, visaPageSelect);

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

  passportPreviewToken += 1;
  visaPreviewToken += 1;

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
