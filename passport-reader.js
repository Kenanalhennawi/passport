import { preprocessImageForOcr } from "./image-processor.js";

export async function readPassport(file, onProgress = () => {}) {
  const warnings = [];

  try {
    onProgress(0.03);

    const fullImage = await preprocessImageForOcr(file);
    onProgress(0.12);

    const mrzImage = await cropMrzZone(file);
    onProgress(0.20);

    const mrzText = await runLocalOcr(mrzImage, (p) => {
      onProgress(0.20 + p * 0.55);
    });

    const fullText = await runLocalOcr(fullImage, (p) => {
      onProgress(0.75 + p * 0.20);
    });

    onProgress(0.96);

    const combinedText = `${mrzText}\n${fullText}`;

    let parsed = null;

    if (window.PVV && window.PVV.MRZParser && typeof window.PVV.MRZParser.parse === "function") {
      parsed = window.PVV.MRZParser.parse(combinedText);
    } else {
      warnings.push("MRZ parser engine was not loaded.");
      parsed = buildFallbackResult(fullText, mrzText, warnings);
    }

    const data = normalizeForCurrentApp(parsed, fullText, mrzText, warnings);

    onProgress(1);

    return {
      type: "primary_document",
      data,
      rawText: fullText,
      mrzText,
      mrz: parsed?.mrzCleaned || [],
      parsed
    };
  } catch (error) {
    warnings.push(error.message || "Passport reading failed.");

    const fallback = buildFallbackResult("", "", warnings);

    return {
      type: "primary_document",
      data: normalizeForCurrentApp(fallback, "", "", warnings),
      rawText: "",
      mrzText: "",
      mrz: [],
      parsed: fallback
    };
  }
}

async function runLocalOcr(imageDataUrl, onProgress = () => {}) {
  if (!window.Tesseract) {
    return "";
  }

  const result = await window.Tesseract.recognize(imageDataUrl, "eng", {
    tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
    preserve_interword_spaces: "0",
    logger: (m) => {
      if (m.status === "recognizing text") {
        onProgress(m.progress || 0);
      }
    }
  });

  return result?.data?.text || "";
}

async function cropMrzZone(file) {
  const image = await loadImage(file);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const cropY = Math.floor(image.height * 0.55);
  const cropHeight = image.height - cropY;
  const scale = 3;

  canvas.width = Math.floor(image.width * scale);
  canvas.height = Math.floor(cropHeight * scale);

  ctx.drawImage(
    image,
    0,
    cropY,
    image.width,
    cropHeight,
    0,
    0,
    canvas.width,
    canvas.height
  );

  enhanceForMrz(ctx, canvas.width, canvas.height);

  return canvas.toDataURL("image/png", 1);
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("Invalid passport image file."));
      return;
    }

    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to load passport image."));
    };

    img.src = url;
  });
}

function enhanceForMrz(ctx, width, height) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const grey = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;

    let value = (grey - 128) * 1.85 + 128;

    if (value > 170) value = 255;
    if (value < 90) value = 0;

    data[i] = clamp(value);
    data[i + 1] = clamp(value);
    data[i + 2] = clamp(value);
  }

  ctx.putImageData(imageData, 0, 0);
}

function normalizeForCurrentApp(parsed, fullText, mrzText, extraWarnings = []) {
  const result = parsed || {};

  const surname = cleanName(result.surname);
  const givenNames = cleanName(result.givenNames);
  const fullName = cleanName(result.fullName || `${givenNames} ${surname}`);

  const gender = normalizeGenderForCurrentApp(result.gender);

  const warnings = [
    ...(Array.isArray(result.warnings) ? result.warnings : []),
    ...extraWarnings
  ].filter(Boolean);

  return {
    documentType: readableDocumentType(result.documentType, result.documentSubtype),
    documentSubtype: result.documentSubtype || "",
    mrzFormat: result.mrzFormat || "NONE",

    issuingCountry: result.issuingCountryCode || "",
    issuingCountryName: result.issuingCountry || "",
    issuingCountryCode: result.issuingCountryCode || "",

    passportNumber: result.documentNumber || "",
    documentNumber: result.documentNumber || "",

    surname,
    givenNames,
    fullName,

    nationality: result.nationalityCode || "",
    nationalityName: result.nationality || "",
    nationalityCode: result.nationalityCode || "",

    dateOfBirth: result.dateOfBirth || "",
    gender,
    expiryDate: result.expiryDate || "",
    issueDate: result.issueDate || "",

    expiryStatus: result.expiryStatus?.status || "",
    daysUntilExpiry: result.expiryStatus?.daysUntilExpiry ?? "",
    daysExpired: result.expiryStatus?.daysExpired ?? "",

    checkDocumentNumber: booleanToPassFail(result.checkDigits?.documentNumber),
    checkDateOfBirth: booleanToPassFail(result.checkDigits?.dateOfBirth),
    checkExpiryDate: booleanToPassFail(result.checkDigits?.expiryDate),
    checkComposite: booleanToPassFail(result.checkDigits?.composite),
    checkAllValid: booleanToPassFail(result.checkDigits?.allValid),

    confidenceScore: formatConfidence(result.confidence),
    confidenceGrade: result.confidence?.grade || "",
    confidenceBreakdown: Array.isArray(result.confidence?.breakdown)
      ? result.confidence.breakdown.join(" | ")
      : "",

    corrections: Array.isArray(result.corrections)
      ? result.corrections.map((item) => `${item.field}: ${item.original} → ${item.corrected}`).join(" | ")
      : "",

    warnings: warnings.join(" | "),

    mrzRawData: Array.isArray(result.mrzCleaned)
      ? result.mrzCleaned.join("\n")
      : "",

    mrzOriginalData: Array.isArray(result.mrzRaw)
      ? result.mrzRaw.join("\n")
      : "",

    rawOcrText: fullText || result.rawOcrText || "",
    rawMrzOcrText: mrzText || "",
    parsedAt: result.parsedAt || new Date().toISOString()
  };
}

function buildFallbackResult(fullText, mrzText, warnings = []) {
  const visible = extractVisibleTextFields(fullText);

  return {
    documentType: "UNKNOWN",
    documentSubtype: "UNKNOWN",
    mrzFormat: "NONE",

    surname: visible.surname,
    givenNames: visible.givenNames,
    fullName: `${visible.givenNames} ${visible.surname}`.replace(/\s+/g, " ").trim(),

    nationality: visible.nationalityName,
    nationalityCode: visible.nationalityCode,

    dateOfBirth: visible.dateOfBirth,
    gender: visible.gender,

    documentNumber: visible.documentNumber,

    issuingCountry: visible.issuingCountryName,
    issuingCountryCode: visible.issuingCountryCode,

    issueDate: visible.issueDate,
    expiryDate: visible.expiryDate,

    expiryStatus: buildExpiryStatus(visible.expiryDate),

    checkDigits: {
      documentNumber: false,
      dateOfBirth: false,
      expiryDate: false,
      composite: false,
      allValid: false
    },

    confidence: {
      score: 35,
      grade: "LOW",
      breakdown: [
        "MRZ parser unavailable or MRZ not detected",
        "Visible OCR fallback used"
      ]
    },

    corrections: [],
    warnings,

    mrzRaw: [],
    mrzCleaned: [],
    rawOcrText: `${mrzText}\n${fullText}`,
    parsedAt: new Date().toISOString()
  };
}

function extractVisibleTextFields(text) {
  const lines = String(text || "")
    .toUpperCase()
    .split(/\r?\n/)
    .map((line) => stripAccents(line).replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return {
    surname: findLineField(lines, ["SURNAME", "FAMILY NAME", "LAST NAME", "NOM"]),
    givenNames: findLineField(lines, ["GIVEN NAMES", "GIVEN NAME", "FIRST NAME", "FORENAME", "NAME"]),
    documentNumber: findByPatterns(text, [
      /PASSPORT\s*(NO|NUMBER)?[^A-Z0-9]*([A-Z0-9]{5,15})/i,
      /DOCUMENT\s*(NO|NUMBER)?[^A-Z0-9]*([A-Z0-9]{5,15})/i
    ]),
    nationalityCode: findByPatterns(text, [
      /NATIONALITY[^A-Z0-9]*([A-Z]{3})/i,
      /COUNTRY\s*CODE[^A-Z0-9]*([A-Z]{3})/i
    ]),
    nationalityName: "",
    issuingCountryCode: findByPatterns(text, [
      /ISSUING\s*COUNTRY[^A-Z0-9]*([A-Z]{3})/i,
      /COUNTRY\s*CODE[^A-Z0-9]*([A-Z]{3})/i
    ]),
    issuingCountryName: "",
    dateOfBirth: findDateByLabels(text, ["DATE OF BIRTH", "DOB", "BIRTH"]),
    gender: normalizeGenderForCurrentApp(findByPatterns(text, [
      /SEX[^A-Z0-9]*(M|F|MALE|FEMALE|X)/i,
      /GENDER[^A-Z0-9]*(M|F|MALE|FEMALE|X)/i
    ])),
    issueDate: findDateByLabels(text, ["DATE OF ISSUE", "ISSUE DATE", "ISSUED"]),
    expiryDate: findDateByLabels(text, ["DATE OF EXPIRY", "EXPIRY DATE", "EXPIRATION DATE", "VALID UNTIL"])
  };
}

function findLineField(lines, labels) {
  const normalizedLabels = labels.map((label) => stripAccents(label).toUpperCase());

  for (let i = 0; i < lines.length; i += 1) {
    const line = stripAccents(lines[i]);

    for (const label of normalizedLabels) {
      if (!line.includes(label)) continue;

      const afterLabel = line
        .replace(new RegExp(`.*${escapeRegex(label)}\\s*[:/-]*\\s*`, "i"), "")
        .trim();

      if (isLikelyName(afterLabel)) {
        return cleanName(afterLabel);
      }

      const nextLine = lines[i + 1] || "";

      if (isLikelyName(nextLine)) {
        return cleanName(nextLine);
      }
    }
  }

  return "";
}

function findByPatterns(text, patterns) {
  const normalized = String(text || "").toUpperCase();

  for (const pattern of patterns) {
    const match = normalized.match(pattern);

    if (match) {
      return cleanSimple(match[2] || match[1]);
    }
  }

  return "";
}

function findDateByLabels(text, labels) {
  const normalized = String(text || "").toUpperCase();

  for (const label of labels) {
    const safe = escapeRegex(label);

    const pattern = new RegExp(
      `${safe}[^0-9A-Z]{0,30}(\\d{4}[/-]\\d{1,2}[/-]\\d{1,2}|\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}|\\d{1,2}\\s+[A-Z]{3,9}\\s+\\d{2,4})`,
      "i"
    );

    const match = normalized.match(pattern);

    if (match) {
      return normalizeDate(match[1]);
    }
  }

  return "";
}

function normalizeDate(value) {
  const clean = String(value || "").trim().toUpperCase();

  const monthMap = {
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

  const textDate = clean.match(/(\d{1,2})\s+([A-Z]{3,9})\s+(\d{2,4})/);

  if (textDate) {
    const day = textDate[1].padStart(2, "0");
    const month = monthMap[textDate[2]] || "";
    let year = textDate[3];

    if (year.length === 2) {
      year = Number(year) > 40 ? `19${year}` : `20${year}`;
    }

    return month ? `${year}-${month}-${day}` : "";
  }

  const iso = clean.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);

  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  }

  const dmy = clean.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);

  if (dmy) {
    let year = dmy[3];

    if (year.length === 2) {
      year = Number(year) > 40 ? `19${year}` : `20${year}`;
    }

    return `${year}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }

  return "";
}

function buildExpiryStatus(expiryDate) {
  if (window.PVV && window.PVV.MRZParser && typeof window.PVV.MRZParser.expiryStatus === "function") {
    return window.PVV.MRZParser.expiryStatus(expiryDate);
  }

  return {
    expired: false,
    status: expiryDate ? "VALID" : "UNKNOWN",
    daysUntilExpiry: null,
    daysExpired: null
  };
}

function readableDocumentType(type, subtype) {
  const cleanType = String(type || "").toUpperCase();
  const cleanSubtype = String(subtype || "").toUpperCase();

  if (cleanType === "PASSPORT" && cleanSubtype === "DIPLOMATIC") return "Diplomatic Passport";
  if (cleanType === "PASSPORT" && cleanSubtype === "SERVICE") return "Service Passport";
  if (cleanType === "PASSPORT" && cleanSubtype === "OFFICIAL") return "Official Passport";
  if (cleanType === "PASSPORT") return "Passport";
  if (cleanSubtype === "REFUGEE") return "Refugee Travel Document";
  if (cleanType === "TRAVEL_DOCUMENT") return "Travel Document";
  if (cleanType === "IDENTITY_CARD") return "Identity / Travel Card";
  if (cleanType === "VISA") return "Visa";

  return cleanType || "Unknown Document";
}

function normalizeGenderForCurrentApp(value) {
  const clean = String(value || "").toUpperCase().trim();

  if (["M", "MALE"].includes(clean)) return "M";
  if (["F", "FEMALE"].includes(clean)) return "F";
  if (["X", "UNSPECIFIED", "<"].includes(clean)) return "X";

  return "";
}

function booleanToPassFail(value) {
  if (value === true) return "PASS";
  if (value === false) return "FAIL";
  return "";
}

function formatConfidence(confidence) {
  if (!confidence || typeof confidence !== "object") return "";

  const score = Number.isFinite(confidence.score) ? `${confidence.score}%` : "";
  const grade = confidence.grade || "";

  if (score && grade) return `${score} - ${grade}`;
  return score || grade || "";
}

function cleanName(value) {
  return stripAccents(String(value || ""))
    .toUpperCase()
    .replace(/</g, " ")
    .replace(/[^A-Z\s'-]/g, " ")
    .replace(/\b(GIVEN|NAME|NAMES|SURNAME|FAMILY|DATE|BIRTH|COUNTRY|CITIZENSHIP|SEX|MALE|FEMALE|DOCUMENT|PASSPORT|TYPE|CODE|NATIONALITY)\b/g, " ")
    .replace(/\b[KLI]{4,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyName(value) {
  const clean = cleanName(value);

  if (!clean) return false;
  if (clean.length < 2 || clean.length > 70) return false;

  if (/(DATE|BIRTH|SEX|COUNTRY|DOCUMENT|PASSPORT|EXPIRY|ISSUE|AUTHORITY|TYPE|CODE|NATIONALITY)/.test(clean)) {
    return false;
  }

  return /^[A-Z\s'-]+$/.test(clean);
}

function cleanSimple(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s/-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripAccents(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clamp(value) {
  return Math.max(0, Math.min(255, value));
}
