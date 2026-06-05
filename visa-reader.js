// visa-reader.js
import {
  preprocessImageForOcr,
  fileToOcrImageDataUrls
} from "./image-processor.js";

export async function readVisaDocument(file, onProgress = () => {}) {
  const warnings = [];

  try {
    onProgress(0.02);

    const pages = await fileToOcrImageDataUrls(file, {
      maxPages: 3,
      scale: 2.5,
      correctOrientation: true   // <-- added
    });

    if (!pages.length) {
      throw new Error("No readable image or PDF page was found.");
    }

    const attempts = [];

    for (let i = 0; i < pages.length; i += 1) {
      const pageStart = 0.05 + i * (0.85 / pages.length);
      const pageRange = 0.85 / pages.length;

      const processedImage = await preprocessImageForOcr(pages[i], { correctOrientation: true });

      onProgress(pageStart + pageRange * 0.15);

      const ocrText = await runLocalOcr(processedImage, (p) => {
        onProgress(pageStart + pageRange * (0.15 + p * 0.75));
      });

      const classification = classifySafely(ocrText);
      const documentType = classification.type;
      const data = parseUniversalDocument(ocrText, documentType, classification);

      attempts.push({
        pageNumber: i + 1,
        processedImage,
        ocrText,
        classification,
        documentType,
        data,
        score: scoreVisaAttempt(ocrText, classification, data)
      });
    }

    const bestAttempt = attempts.sort((a, b) => b.score - a.score)[0];

    if (!bestAttempt) {
      throw new Error("Unable to process visa or residence document.");
    }

    if (bestAttempt.score < 35) {
      warnings.push("Low confidence secondary document read. Please use a clearer image or PDF scan.");
    }

    bestAttempt.data.selectedPage = bestAttempt.pageNumber;
    bestAttempt.data.processingScore = bestAttempt.score;

    if (warnings.length) {
      bestAttempt.data.warnings = warnings.join(" | ");
    }

    onProgress(1);

    return {
      type: "secondary_document",
      documentType: bestAttempt.documentType,
      classification: bestAttempt.classification,
      data: bestAttempt.data,
      rawText: bestAttempt.ocrText,
      attempts: attempts.map((item) => ({
        pageNumber: item.pageNumber,
        score: item.score,
        documentType: item.documentType,
        classificationConfidence: item.classification?.confidence || 0,
        fullName: item.data?.fullName || "",
        documentNumber: item.data?.documentNumber || "",
        passportNumber: item.data?.passportNumber || "",
        dateOfBirth: item.data?.dateOfBirth || "",
        expiryDate: item.data?.expiryDate || ""
      }))
    };
  } catch (error) {
    const message = error?.message || "Visa / residence document reading failed.";

    onProgress(1);

    return {
      type: "secondary_document",
      documentType: "Unknown Document",
      classification: {
        type: "Unknown Document",
        category: "Other",
        route: "generic",
        confidence: 0,
        matchedKeywords: [],
        alternatives: []
      },
      data: {
        documentType: "Unknown Document",
        classificationType: "Unknown Document",
        classificationConfidence: "0%",
        documentCategory: "Other",
        documentNumber: "",
        visaNumber: "",
        passportNumber: "",
        applicationNumber: "",
        uci: "",
        surname: "",
        givenNames: "",
        fullName: "",
        nationality: "",
        citizenship: "",
        countryOfBirth: "",
        dateOfBirth: "",
        gender: "",
        issueDate: "",
        expiryDate: "",
        entries: "",
        durationOfStay: "",
        validFrom: "",
        validUntil: "",
        issuingCountry: "",
        matchedClassificationKeywords: "",
        confidenceScore: "OCR failed or unsupported document.",
        warnings: message
      },
      rawText: "",
      attempts: []
    };
  }
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

function classifySafely(ocrText) {
  if (
    window.PVV &&
    window.PVV.DocumentClassifier &&
    typeof window.PVV.DocumentClassifier.classifyDocument === "function"
  ) {
    return window.PVV.DocumentClassifier.classifyDocument(ocrText);
  }

  return {
    type: "Unknown Document",
    category: "Other",
    route: "generic",
    confidence: 0,
    matchedKeywords: [],
    alternatives: []
  };
}

function scoreVisaAttempt(text, classification, data) {
  let score = 0;

  if (text && text.trim().length > 30) score += 20;
  if (classification?.confidence) score += Math.min(30, classification.confidence);
  if (data?.documentNumber) score += 12;
  if (data?.visaNumber) score += 12;
  if (data?.passportNumber) score += 12;
  if (data?.applicationNumber) score += 10;
  if (data?.uci) score += 10;
  if (data?.surname) score += 8;
  if (data?.givenNames) score += 8;
  if (data?.fullName) score += 8;
  if (data?.dateOfBirth) score += 10;
  if (data?.gender) score += 5;
  if (data?.expiryDate) score += 10;
  if (data?.issueDate) score += 5;
  if (data?.issuingCountry) score += 5;

  return Math.max(0, Math.min(100, score));
}

function parseUniversalDocument(text, documentType, classification) {
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
    "HOLDER",
    "NAME"
  ]);

  const fullName = givenNames && surname
    ? `${givenNames} ${surname}`.trim()
    : detectedFullName;

  return {
    documentType,
    classificationType: documentType,
    classificationConfidence: `${classification.confidence || 0}%`,
    documentCategory: determineCategory(documentType),

    documentNumber: findDocumentNumber(lines, flatText),

    visaNumber: findByPatterns(flatText, [
      /VISA\s*(NO|NUMBER)?\s*[:\-]?\s*([A-Z0-9]{5,25})/i,
      /VAF\s*(NO|NUMBER)?\s*[:\-]?\s*([A-Z0-9]{5,25})/i,
      /VIGNETTE\s*(NO|NUMBER)?\s*[:\-]?\s*([A-Z0-9]{5,25})/i
    ]),

    passportNumber: findByPatterns(flatText, [
      /PASSPORT\s*(NO|NUMBER)?\s*[:\-]?\s*([A-Z0-9]{5,25})/i,
      /P\.?\s*NO\s*[:\-]?\s*([A-Z0-9]{5,25})/i,
      /DOCUMENT\s*(NO|NUMBER)?\s*[:\-]?\s*([A-Z0-9]{5,25})/i
    ]),

    applicationNumber: findByPatterns(flatText, [
      /APPLICATION\s*(NO|NUMBER)?\s*[:\-]?\s*([A-Z0-9]{5,25})/i,
      /APP\s*(NO|NUMBER)?\s*[:\-]?\s*([A-Z0-9]{5,25})/i
    ]),

    uci: findByPatterns(flatText, [
      /\bUCI\s*[:\-]?\s*([A-Z0-9]{5,20})/i,
      /\bUC\s*[:\-]?\s*([A-Z0-9]{5,20})/i
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

    durationOfStay: findLabeledValue(lines, [
      "DURATION OF STAY",
      "DURATION"
    ]),

    validFrom: findDateByLabels(lines, [
      "VALID FROM",
      "FROM"
    ]),

    validUntil: findDateByLabels(lines, [
      "VALID UNTIL",
      "VALID TO",
      "UNTIL"
    ]),

    issuingCountry: detectIssuingCountry(text),

    matchedClassificationKeywords: Array.isArray(classification.matchedKeywords)
      ? classification.matchedKeywords.join(", ")
      : "",

    confidenceScore: text
      ? "OCR detected text. Field extraction uses line-based parsing and document classification."
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

function determineCategory(documentType) {
  const type = String(documentType || "");

  if (type.includes("Passport") || type.includes("Travel Document")) {
    return "Primary Travel Document";
  }

  if (type.includes("Visa") || type.includes("Permit")) {
    return "Immigration Authorization";
  }

  if (type.includes("Resident") || type.includes("Residence")) {
    return "Residence Document";
  }

  if (type.includes("ID") || type.includes("Identity")) {
    return "Identity Document";
  }

  if (type.includes("Refugee Protection Claimant")) {
    return "Immigration / Protection Document";
  }

  return "Other";
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
    "PERMIT NO",
    "ID NUMBER"
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

  return /^(FAMILY NAME|SURNAME|GIVEN NAME|GIVEN NAMES|DATE OF BIRTH|DOB|SEX|GENDER|COUNTRY OF BIRTH|COUNTRY OF CITIZENSHIP|NATIONALITY|DATE ISSUED|ISSUE DATE|EXPIRY DATE|EXPIRATION DATE|APPLICATION NO|UCI|DOCUMENT NO|PASSPORT NO|VISA NO|ADDITIONAL INFORMATION|CLIENT INFORMATION|VALID FROM|VALID UNTIL|DURATION OF STAY|ENTRIES)\b/.test(value);
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
    .replace(/\b(FAMILY|SURNAME|GIVEN|NAME|NAMES|FIRST|LAST|DATE|BIRTH|SEX|COUNTRY|CITIZENSHIP|NATIONALITY|VALID|UNTIL|FROM|EXPIRY|ISSUE)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanCountry(value) {
  return stripAccents(String(value || ""))
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ")
    .replace(/\b(DATE|ISSUED|ISSUE|EXPIRY|EXPIRATION|COUNTRY|CITIZENSHIP|BIRTH|NATIONALITY|VALID|UNTIL|FROM)\b/g, " ")
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
