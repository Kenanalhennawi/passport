import { preprocessImageForOcr } from "./image-processor.js";

export async function readVisaDocument(file, onProgress = () => {}) {
  onProgress(0.02);

  const processedImage = await preprocessImageForOcr(file);
  onProgress(0.10);

  const ocrText = await runLocalOcr(processedImage, (p) => onProgress(0.10 + p * 0.85));
  const documentType = detectDocumentType(ocrText);
  const data = parseUniversalDocument(ocrText, documentType);

  onProgress(1);

  return {
    type: "secondary_document",
    documentType,
    data,
    rawText: ocrText
  };
}

async function runLocalOcr(imageDataUrl, onProgress = () => {}) {
  if (!window.Tesseract) return "";

  const result = await window.Tesseract.recognize(imageDataUrl, "eng", {
    logger: (m) => {
      if (m.status === "recognizing text") {
        onProgress(m.progress || 0);
      }
    }
  });

  return result?.data?.text || "";
}

function parseUniversalDocument(text, documentType) {
  const lines = getCleanLines(text);
  const flatText = lines.join("\n");

  const surname = findLabeledValue(lines, [
    "FAMILY NAME",
    "SURNAME",
    "LAST NAME",
    "NOM"
  ]);

  const givenNames = findLabeledValue(lines, [
    "GIVEN NAME(S)",
    "GIVEN NAMES",
    "GIVEN NAME",
    "FIRST NAME",
    "FORENAME",
    "PRENOMS",
    "PRÉNOMS"
  ]);

 const detectedFullName = findLabeledValue(lines, [
  "FULL NAME",
  "NAME OF HOLDER",
  "HOLDER"
]);

const fullName = givenNames && surname
  ? `${givenNames} ${surname}`.trim()
  : detectedFullName;

  return {
    documentType,

    documentNumber: findDocumentNumber(lines, flatText),
    visaNumber: findByPatterns(flatText, [
      /VISA\s*(NO|NUMBER)?\s*[:\-]?\s*([A-Z0-9]{5,20})/i,
      /VAF\s*(NO|NUMBER)?\s*[:\-]?\s*([A-Z0-9]{5,20})/i
    ]),

    passportNumber: findByPatterns(flatText, [
      /PASSPORT\s*(NO|NUMBER)?\s*[:\-]?\s*([A-Z0-9]{5,20})/i,
      /P\.?\s*NO\s*[:\-]?\s*([A-Z0-9]{5,20})/i
    ]),

    applicationNumber: findByPatterns(flatText, [
      /APPLICATION\s*(NO|NUMBER)?\s*[:\-]?\s*([A-Z0-9]{5,25})/i
    ]),

    uci: findByPatterns(flatText, [
      /\bUCI\s*[:\-]?\s*([A-Z0-9]{5,20})/i
    ]),

    surname,
    givenNames,
    fullName: cleanName(fullName),

    nationality: findLabeledValue(lines, [
      "NATIONALITY",
      "NATION"
    ]),

    citizenship: findLabeledValue(lines, [
      "COUNTRY OF CITIZENSHIP",
      "CITIZENSHIP"
    ]),

    countryOfBirth: findLabeledValue(lines, [
      "COUNTRY OF BIRTH",
      "PLACE OF BIRTH",
      "BIRTH PLACE"
    ]),

    dateOfBirth: findDateByLabels(lines, [
      "DATE OF BIRTH",
      "DOB",
      "BIRTH"
    ]),

    gender: normalizeGender(findLabeledValue(lines, [
      "SEX",
      "GENDER"
    ])),

    issueDate: findDateByLabels(lines, [
      "DATE ISSUED",
      "ISSUE DATE",
      "DATE OF ISSUE",
      "ISSUED"
    ]),

    expiryDate: findDateByLabels(lines, [
      "EXPIRY DATE",
      "EXPIRATION DATE",
      "VALID UNTIL",
      "VALID TO",
      "EXPIRES"
    ]),

    entries: findLabeledValue(lines, [
      "ENTRIES",
      "NO. OF ENTRIES",
      "NUMBER OF ENTRIES"
    ]),

    issuingCountry: detectIssuingCountry(text),

    confidenceScore: text
      ? "OCR detected text. Field extraction uses line-based parsing."
      : "OCR library unavailable or no text detected."
  };
}

function getCleanLines(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => stripAccents(line).toUpperCase())
    .map((line) => line.replace(/[|]/g, "I"))
    .map((line) => line.replace(/[“”]/g, '"'))
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function detectDocumentType(text) {
  const value = stripAccents(String(text || "")).toUpperCase();

  if (value.includes("REFUGEE PROTECTION CLAIMANT DOCUMENT")) return "Refugee Protection Claimant Document";
  if (value.includes("REFUGEE TRAVEL DOCUMENT")) return "Refugee Travel Document";
  if (value.includes("PERMANENT RESIDENT") || value.includes("PR CARD")) return "Permanent Resident Card";
  if (value.includes("GREEN CARD")) return "Permanent Resident Card";
  if (value.includes("RESIDENCE PERMIT") || value.includes("RESIDENCE CARD")) return "Residence Permit / Residence Card";
  if (value.includes("RESIDENCE VISA")) return "Residence Visa";
  if (value.includes("ENTRY PERMIT")) return "Entry Permit";
  if (value.includes("WORK PERMIT")) return "Work Permit";
  if (value.includes("STUDY PERMIT") || value.includes("STUDENT PERMIT")) return "Study Permit";
  if (value.includes("EMIRATES ID")) return "Emirates ID";
  if (value.includes("CIVIL ID")) return "Civil ID";
  if (value.includes("SCHENGEN")) return "Schengen Visa";
  if (value.includes("VISA")) return "Visa";
  if (value.includes("TRAVEL DOCUMENT")) return "Travel Document";

  return "Unknown Travel / Immigration Document";
}

function findLabeledValue(lines, labels) {
  const normalizedLabels = labels.map((label) => stripAccents(label).toUpperCase());

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    for (const label of normalizedLabels) {
      const labelRegex = new RegExp(`\\b${escapeRegex(label).replace(/\\ /g, "\\s*")}\\b\\s*[:\\-]?\\s*(.*)$`, "i");
      const match = line.match(labelRegex);

      if (match) {
        const sameLineValue = cleanFieldValue(match[1]);

        if (isUsefulFieldValue(sameLineValue)) {
          return cleanByFieldType(label, sameLineValue);
        }

        for (let offset = 1; offset <= 2; offset += 1) {
          const next = lines[i + offset] || "";

          if (looksLikeLabelLine(next)) break;

          const nextValue = cleanFieldValue(next);

          if (isUsefulFieldValue(nextValue)) {
            return cleanByFieldType(label, nextValue);
          }
        }
      }
    }
  }

  return "";
}

function findDateByLabels(lines, labels) {
  const normalizedLabels = labels.map((label) => stripAccents(label).toUpperCase());

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    for (const label of normalizedLabels) {
      const labelPattern = escapeRegex(label).replace(/\\ /g, "\\s*");

      if (new RegExp(`\\b${labelPattern}\\b`, "i").test(line)) {
        const sameLineDate = extractDate(line);

        if (sameLineDate) return sameLineDate;

        for (let offset = 1; offset <= 2; offset += 1) {
          const next = lines[i + offset] || "";
          if (looksLikeLabelLine(next)) break;

          const nextDate = extractDate(next);
          if (nextDate) return nextDate;
        }
      }
    }
  }

  return "";
}

function findDocumentNumber(lines, flatText) {
  const labeled = findLabeledValue(lines, [
    "DOCUMENT NO",
    "DOCUMENT NUMBER",
    "DOC NO",
    "CARD NO",
    "PERMIT NO"
  ]);

  if (labeled && /^[A-Z0-9]{5,25}$/.test(labeled.replace(/\s/g, ""))) {
    return labeled.replace(/\s/g, "");
  }

  const topCandidates = findAllByPattern(flatText, /\b[A-Z]{1,4}[0-9]{5,12}\b/g);

  if (topCandidates.length) {
    return topCandidates[0];
  }

  return "";
}

function findByPatterns(text, patterns) {
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);

    if (match) {
      return cleanSimpleValue(match[2] || match[1]);
    }
  }

  return "";
}

function findAllByPattern(text, pattern) {
  const matches = String(text || "").match(pattern);
  return matches ? [...new Set(matches.map(cleanSimpleValue))] : [];
}

function looksLikeLabelLine(line) {
  const value = String(line || "").toUpperCase();

  return /^(FAMILY NAME|SURNAME|GIVEN NAME|GIVEN NAMES|DATE OF BIRTH|DOB|SEX|GENDER|COUNTRY OF BIRTH|COUNTRY OF CITIZENSHIP|NATIONALITY|DATE ISSUED|ISSUE DATE|EXPIRY DATE|EXPIRATION DATE|APPLICATION NO|UCI|DOCUMENT NO|PASSPORT NO|VISA NO|ADDITIONAL INFORMATION|CLIENT INFORMATION)\b/.test(value);
}

function isUsefulFieldValue(value) {
  const clean = String(value || "").trim();

  if (!clean) return false;
  if (clean.length > 60) return false;
  if (/^(CLIENT INFORMATION|ADDITIONAL INFORMATION|PROTECTED WHEN COMPLETED|NOT VALID FOR TRAVEL)$/.test(clean)) return false;

  return true;
}

function cleanByFieldType(label, value) {
  const cleanLabel = stripAccents(label).toUpperCase();

  if (
    cleanLabel.includes("NAME") ||
    cleanLabel.includes("SURNAME") ||
    cleanLabel.includes("NOM") ||
    cleanLabel.includes("PRENOM") ||
    cleanLabel.includes("HOLDER")
  ) {
    return cleanName(value);
  }

  if (
    cleanLabel.includes("CITIZENSHIP") ||
    cleanLabel.includes("BIRTH") ||
    cleanLabel.includes("NATIONALITY") ||
    cleanLabel.includes("NATION")
  ) {
    return cleanCountry(value);
  }

  return cleanSimpleValue(value);
}

function cleanFieldValue(value) {
  return String(value || "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\bYYYY\b|\bYYY\b|\bMM\b|\bDD\b|\bOD\b/gi, "")
    .replace(/^[\s:;,\-.]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanName(value) {
  return stripAccents(String(value || ""))
    .toUpperCase()
    .replace(/[^A-Z\s'-]/g, " ")
    .replace(/\b(FAMILY|SURNAME|GIVEN|NAME|NAMES|FIRST|LAST|DATE|BIRTH|SEX|COUNTRY|CITIZENSHIP|NATIONALITY)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanCountry(value) {
  return stripAccents(String(value || ""))
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ")
    .replace(/\b(DATE|ISSUED|ISSUE|EXPIRY|EXPIRATION|COUNTRY|CITIZENSHIP|BIRTH|NATIONALITY)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanSimpleValue(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s/-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractDate(value) {
  const text = String(value || "").toUpperCase();

  const iso = text.match(/\b(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  }

  const dmy = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (dmy) {
    let year = dmy[3];

    if (year.length === 2) year = Number(year) > 40 ? `19${year}` : `20${year}`;

    return `${year}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }

  const textDate = text.match(/\b(\d{1,2})\s+([A-Z]{3,9})\s+(\d{2,4})\b/);
  if (textDate) {
    const month = monthNumber(textDate[2]);
    let year = textDate[3];

    if (year.length === 2) year = Number(year) > 40 ? `19${year}` : `20${year}`;

    return month ? `${year}-${month}-${textDate[1].padStart(2, "0")}` : "";
  }

  return "";
}

function monthNumber(month) {
  const map = {
    JAN: "01",
    JANUARY: "01",
    FEB: "02",
    FEBRUARY: "02",
    MAR: "03",
    MARS: "03",
    MARCH: "03",
    APR: "04",
    APRIL: "04",
    MAY: "05",
    MAI: "05",
    JUN: "06",
    JUNE: "06",
    JUL: "07",
    JULY: "07",
    AUG: "08",
    AUGUST: "08",
    SEP: "09",
    SEPTEMBER: "09",
    OCT: "10",
    OCTOBER: "10",
    NOV: "11",
    NOVEMBER: "11",
    DEC: "12",
    DECEMBER: "12"
  };

  return map[String(month || "").toUpperCase()] || "";
}

function normalizeGender(value) {
  const clean = String(value || "").toUpperCase().trim();

  if (["M", "MALE"].includes(clean)) return "M";
  if (["F", "FEMALE"].includes(clean)) return "F";
  if (clean === "X") return "X";

  return "";
}

function detectIssuingCountry(text) {
  const value = stripAccents(String(text || "")).toUpperCase();

  if (value.includes("CANADA")) return "CAN";
  if (value.includes("UNITED ARAB EMIRATES") || value.includes("UAE")) return "ARE";
  if (value.includes("UNITED STATES")) return "USA";
  if (value.includes("UNITED KINGDOM")) return "GBR";
  if (value.includes("SAUDI ARABIA")) return "SAU";
  if (value.includes("QATAR")) return "QAT";
  if (value.includes("KUWAIT")) return "KWT";
  if (value.includes("BAHRAIN")) return "BHR";
  if (value.includes("OMAN")) return "OMN";
  if (value.includes("SCHENGEN")) return "SCHENGEN";

  return "";
}

function stripAccents(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}