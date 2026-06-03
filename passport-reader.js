import { preprocessImageForOcr } from "./image-processor.js";

export async function readPassport(file, onProgress = () => {}) {
  onProgress(0.02);

  const fullImage = await preprocessImageForOcr(file);
  onProgress(0.08);

  const mrzImage = await cropMrzZone(file);
  onProgress(0.14);

  const mrzText = await runLocalOcr(mrzImage, (p) => onProgress(0.14 + p * 0.50));
  const fullText = await runLocalOcr(fullImage, (p) => onProgress(0.64 + p * 0.30));

  const mrzCandidates = [
    ...extractMrzCandidates(mrzText),
    ...extractMrzCandidates(fullText)
  ];

  const bestMrz = selectBestMrz(mrzCandidates);
  const data = parseTravelDocument(bestMrz, fullText);

  onProgress(1);

  return {
    type: "primary_document",
    data,
    rawText: fullText,
    mrzText,
    mrz: bestMrz
  };
}

async function runLocalOcr(imageDataUrl, onProgress = () => {}) {
  if (!window.Tesseract) return "";

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

  const cropY = Math.floor(image.height * 0.58);
  const cropHeight = image.height - cropY;
  const scale = 2.8;

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
      reject(new Error("Invalid document image file."));
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
      reject(new Error("Unable to load document image."));
    };

    img.src = url;
  });
}

function enhanceForMrz(ctx, width, height) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const grey = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    let value = (grey - 128) * 1.65 + 128;

    if (value > 168) value = 255;
    if (value < 92) value = 0;

    data[i] = clamp(value);
    data[i + 1] = clamp(value);
    data[i + 2] = clamp(value);
  }

  ctx.putImageData(imageData, 0, 0);
}

function extractMrzCandidates(text) {
  const lines = String(text || "")
    .toUpperCase()
    .split(/\r?\n/)
    .map(cleanOcrMrzLine)
    .filter((line) => line.length >= 20);

  const candidates = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (looksLikeTd3Line1(line) && lines[i + 1]) {
      const line1 = fixMrzLine(lines[i], 44);
      const line2 = fixMrzLine(lines[i + 1], 44);

      if (looksLikeTd3Pair(line1, line2)) {
        candidates.push({
          format: "TD3",
          lines: [line1, line2],
          score: scoreTd3(line1, line2)
        });
      }
    }

    if (looksLikeTd1Line1(line) && lines[i + 1] && lines[i + 2]) {
      const line1 = fixMrzLine(lines[i], 30);
      const line2 = fixMrzLine(lines[i + 1], 30);
      const line3 = fixMrzLine(lines[i + 2], 30);

      if (looksLikeTd1Triplet(line1, line2, line3)) {
        candidates.push({
          format: "TD1",
          lines: [line1, line2, line3],
          score: scoreTd1(line1, line2, line3)
        });
      }
    }

    if (looksLikeTd2Line1(line) && lines[i + 1]) {
      const line1 = fixMrzLine(lines[i], 36);
      const line2 = fixMrzLine(lines[i + 1], 36);

      if (looksLikeTd2Pair(line1, line2)) {
        candidates.push({
          format: "TD2",
          lines: [line1, line2],
          score: scoreTd2(line1, line2)
        });
      }
    }
  }

  return candidates;
}

function cleanOcrMrzLine(line) {
  return String(line || "")
    .toUpperCase()
    .replace(/\s/g, "")
    .replace(/«/g, "<")
    .replace(/‹/g, "<")
    .replace(/≤/g, "<")
    .replace(/[{[(]/g, "<")
    .replace(/[^A-Z0-9<]/g, "");
}

function fixMrzLine(line, targetLength) {
  let value = String(line || "").toUpperCase();

  value = value.replace(/[^A-Z0-9<]/g, "");

  value = value.replace(/([A-Z0-9])<{0,1}[<]{2,}/g, (m) => m);

  if (value.length > targetLength) {
    value = value.slice(0, targetLength);
  }

  return value.padEnd(targetLength, "<");
}

function looksLikeTd3Line1(line) {
  return /^[A-Z][A-Z<][A-Z]{3}/.test(line) && line.length >= 35;
}

function looksLikeTd3Pair(line1, line2) {
  return /^[A-Z][A-Z<][A-Z]{3}/.test(line1)
    && /^[A-Z0-9<]{9}[0-9<][A-Z]{3}[0-9]{6}[0-9<][MFX<][0-9]{6}/.test(line2);
}

function looksLikeTd1Line1(line) {
  return /^[A-Z][A-Z<][A-Z]{3}/.test(line) && line.length >= 25;
}

function looksLikeTd1Triplet(line1, line2, line3) {
  return /^[A-Z][A-Z<][A-Z]{3}/.test(line1)
    && /[0-9]{6}/.test(line2)
    && line3.includes("<");
}

function looksLikeTd2Line1(line) {
  return /^[A-Z][A-Z<][A-Z]{3}/.test(line) && line.length >= 30;
}

function looksLikeTd2Pair(line1, line2) {
  return /^[A-Z][A-Z<][A-Z]{3}/.test(line1)
    && /[0-9]{6}/.test(line2);
}

function selectBestMrz(candidates) {
  if (!candidates.length) return null;

  return candidates.sort((a, b) => b.score - a.score)[0];
}

function scoreTd3(line1, line2) {
  let score = 0;

  if (line1.length === 44) score += 10;
  if (line2.length === 44) score += 10;
  if (line1.includes("<<")) score += 30;
  if (checkDigit(line2.slice(0, 9), line2[9])) score += 25;
  if (checkDigit(line2.slice(13, 19), line2[19])) score += 25;
  if (checkDigit(line2.slice(21, 27), line2[27])) score += 25;
  if (["M", "F", "X", "<"].includes(line2[20])) score += 10;

  return score;
}

function scoreTd1(line1, line2, line3) {
  let score = 0;

  if (line1.length === 30) score += 10;
  if (line2.length === 30) score += 10;
  if (line3.length === 30) score += 10;
  if (line3.includes("<<")) score += 25;
  if (checkDigit(line1.slice(5, 14), line1[14])) score += 20;
  if (checkDigit(line2.slice(0, 6), line2[6])) score += 20;
  if (checkDigit(line2.slice(8, 14), line2[14])) score += 20;

  return score;
}

function scoreTd2(line1, line2) {
  let score = 0;

  if (line1.length === 36) score += 10;
  if (line2.length === 36) score += 10;
  if (line1.includes("<<")) score += 25;
  if (checkDigit(line2.slice(0, 9), line2[9])) score += 20;
  if (checkDigit(line2.slice(13, 19), line2[19])) score += 20;
  if (checkDigit(line2.slice(21, 27), line2[27])) score += 20;

  return score;
}

function parseTravelDocument(candidate, rawText) {
  if (!candidate) {
    return buildFallbackFromVisibleText(rawText);
  }

  if (candidate.format === "TD3") {
    return parseTd3(candidate.lines, rawText);
  }

  if (candidate.format === "TD1") {
    return parseTd1(candidate.lines, rawText);
  }

  if (candidate.format === "TD2") {
    return parseTd2(candidate.lines, rawText);
  }

  return buildFallbackFromVisibleText(rawText);
}

function parseTd3(lines, rawText) {
  const line1 = lines[0];
  const line2 = lines[1];

  const documentCode = line1.slice(0, 2).replace(/</g, "");
  const issuingCountry = line1.slice(2, 5).replace(/</g, "");
  const name = parseMrzName(line1.slice(5));

  const passportNumber = line2.slice(0, 9).replace(/</g, "");
  const nationalityRaw = line2.slice(10, 13).replace(/</g, "");
  const dateOfBirth = formatBirthDate(line2.slice(13, 19));
  const gender = normalizeGender(line2.slice(20, 21));
  const expiryDate = formatExpiryDate(line2.slice(21, 27));

  const visibleName = extractVisibleName(rawText);
  const resolvedName = resolveName(name, visibleName);

  return {
    documentType: detectPrimaryDocumentType(documentCode, nationalityRaw, rawText),
    issuingCountry,
    passportNumber,
    surname: resolvedName.surname,
    givenNames: resolvedName.givenNames,
    fullName: `${resolvedName.givenNames} ${resolvedName.surname}`.trim(),
    nationality: normalizeNationality(nationalityRaw, rawText),
    dateOfBirth,
    gender,
    expiryDate,
    mrzRawData: `${line1}\n${line2}`,
    confidenceScore: buildConfidence(lines, "TD3", resolvedName.confidence)
  };
}

function parseTd1(lines, rawText) {
  const line1 = lines[0];
  const line2 = lines[1];
  const line3 = lines[2];

  const documentCode = line1.slice(0, 2).replace(/</g, "");
  const issuingCountry = line1.slice(2, 5).replace(/</g, "");
  const documentNumber = line1.slice(5, 14).replace(/</g, "");
  const dateOfBirth = formatBirthDate(line2.slice(0, 6));
  const gender = normalizeGender(line2.slice(7, 8));
  const expiryDate = formatExpiryDate(line2.slice(8, 14));
  const nationalityRaw = line2.slice(15, 18).replace(/</g, "");
  const name = parseMrzName(line3);

  const visibleName = extractVisibleName(rawText);
  const resolvedName = resolveName(name, visibleName);

  return {
    documentType: detectPrimaryDocumentType(documentCode, nationalityRaw, rawText),
    issuingCountry,
    passportNumber: documentNumber,
    surname: resolvedName.surname,
    givenNames: resolvedName.givenNames,
    fullName: `${resolvedName.givenNames} ${resolvedName.surname}`.trim(),
    nationality: normalizeNationality(nationalityRaw, rawText),
    dateOfBirth,
    gender,
    expiryDate,
    mrzRawData: `${line1}\n${line2}\n${line3}`,
    confidenceScore: buildConfidence(lines, "TD1", resolvedName.confidence)
  };
}

function parseTd2(lines, rawText) {
  const line1 = lines[0];
  const line2 = lines[1];

  const documentCode = line1.slice(0, 2).replace(/</g, "");
  const issuingCountry = line1.slice(2, 5).replace(/</g, "");
  const name = parseMrzName(line1.slice(5));

  const passportNumber = line2.slice(0, 9).replace(/</g, "");
  const nationalityRaw = line2.slice(10, 13).replace(/</g, "");
  const dateOfBirth = formatBirthDate(line2.slice(13, 19));
  const gender = normalizeGender(line2.slice(20, 21));
  const expiryDate = formatExpiryDate(line2.slice(21, 27));

  const visibleName = extractVisibleName(rawText);
  const resolvedName = resolveName(name, visibleName);

  return {
    documentType: detectPrimaryDocumentType(documentCode, nationalityRaw, rawText),
    issuingCountry,
    passportNumber,
    surname: resolvedName.surname,
    givenNames: resolvedName.givenNames,
    fullName: `${resolvedName.givenNames} ${resolvedName.surname}`.trim(),
    nationality: normalizeNationality(nationalityRaw, rawText),
    dateOfBirth,
    gender,
    expiryDate,
    mrzRawData: `${line1}\n${line2}`,
    confidenceScore: buildConfidence(lines, "TD2", resolvedName.confidence)
  };
}

function parseMrzName(nameZone) {
  let zone = String(nameZone || "").toUpperCase();

  zone = zone.replace(/[^A-Z<]/g, "<");
  zone = zone.replace(/<{3,}/g, "<<");

  const doubleIndex = zone.indexOf("<<");

  if (doubleIndex >= 0) {
    return {
      surname: cleanName(zone.slice(0, doubleIndex).replace(/</g, " ")),
      givenNames: cleanName(zone.slice(doubleIndex + 2).replace(/</g, " "))
    };
  }

  const parts = zone.split("<").filter(Boolean);

  return {
    surname: cleanName(parts[0] || ""),
    givenNames: cleanName(parts.slice(1).join(" "))
  };
}

function extractVisibleName(text) {
  const lines = String(text || "")
    .toUpperCase()
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  return {
    surname: findFieldValue(lines, [
      "SURNAME",
      "FAMILY NAME",
      "LAST NAME",
      "NOM"
    ]),
    givenNames: findFieldValue(lines, [
      "GIVEN NAMES",
      "GIVEN NAME",
      "FIRST NAME",
      "PRENOMS",
      "PRÉNOMS"
    ])
  };
}

function findFieldValue(lines, labels) {
  for (let i = 0; i < lines.length; i += 1) {
    const line = stripAccents(lines[i]);

    for (const label of labels) {
      const normalizedLabel = stripAccents(label);

      if (line.includes(normalizedLabel)) {
        const afterLabel = line
          .replace(new RegExp(`.*${escapeRegex(normalizedLabel)}\\s*[:/-]*\\s*`, "i"), "")
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
  }

  return "";
}

function resolveName(mrzName, visibleName) {
  const mrzSurname = cleanName(mrzName.surname);
  const mrzGiven = cleanName(mrzName.givenNames);
  const visibleSurname = cleanName(visibleName.surname);
  const visibleGiven = cleanName(visibleName.givenNames);

  const surname = chooseName(mrzSurname, visibleSurname);
  const givenNames = chooseName(mrzGiven, visibleGiven);

  return {
    surname,
    givenNames,
    confidence: surname && givenNames
      ? "High - MRZ name resolved with visible text validation"
      : "Medium - name partially resolved"
  };
}

function chooseName(mrzValue, visibleValue) {
  const mrz = cleanName(mrzValue);
  const visible = cleanName(visibleValue);

  if (!mrz && visible) return visible;
  if (mrz && !visible) return mrz;
  if (!mrz && !visible) return "";

  const mrzScore = nameQualityScore(mrz);
  const visibleScore = nameQualityScore(visible);

  if (visibleScore > mrzScore + 10) return visible;
  return mrz;
}

function nameQualityScore(value) {
  const clean = cleanName(value);
  if (!clean) return 0;

  let score = clean.length;
  const tokens = clean.split(" ").filter(Boolean);

  score += tokens.length * 5;

  if (tokens.some((token) => token.length === 1)) score -= 12;
  if (tokens.some((token) => /^(P|PR|ID|VISA|PASSPORT|DOCUMENT)$/.test(token))) score -= 30;
  if (/(GIVEN|NAME|SURNAME|FAMILY|DATE|BIRTH|COUNTRY|SEX|ISSUE|EXPIRY)/.test(clean)) score -= 40;

  return score;
}

function isLikelyName(value) {
  const clean = cleanName(value);

  if (!clean) return false;
  if (clean.length < 2 || clean.length > 55) return false;
  if (/(DATE|BIRTH|SEX|COUNTRY|DOCUMENT|PASSPORT|EXPIRY|ISSUE|AUTHORITY|CANADA|TYPE)/.test(clean)) return false;

  return /^[A-Z\s'-]+$/.test(clean);
}

function cleanName(value) {
  return stripAccents(String(value || ""))
    .toUpperCase()
    .replace(/</g, " ")
    .replace(/\b[KLI]{2,}\b/g, " ")
    .replace(/\b[A-Z]*[KLI]{6,}\b/g, " ")
    .replace(/[^A-Z\s'-]/g, " ")
    .replace(/\b(GIVEN|NAME|NAMES|SURNAME|FAMILY|DATE|BIRTH|COUNTRY|CITIZENSHIP|SEX|MALE|FEMALE|DOCUMENT|PASSPORT)\b/g, " ")
    .replace(/\b(PR|P|ID)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFallbackFromVisibleText(rawText) {
  const visibleName = extractVisibleName(rawText);

  return {
    documentType: detectDocumentTypeFromText(rawText),
    issuingCountry: detectIssuingCountry(rawText),
    passportNumber: extractVisibleDocumentNumber(rawText),
    surname: visibleName.surname,
    givenNames: visibleName.givenNames,
    fullName: `${visibleName.givenNames} ${visibleName.surname}`.trim(),
    nationality: extractVisibleNationality(rawText),
    dateOfBirth: extractDateFromText(rawText, ["DATE OF BIRTH", "DOB", "BIRTH"]),
    gender: normalizeGender(extractTextValue(rawText, [/SEX[^A-Z0-9]*(M|F|MALE|FEMALE|X)/i])),
    expiryDate: extractDateFromText(rawText, ["DATE OF EXPIRY", "EXPIRY DATE", "EXPIRATION DATE", "VALID UNTIL"]),
    mrzRawData: "",
    confidenceScore: "Medium - MRZ not detected clearly, visible text used"
  };
}

function detectPrimaryDocumentType(code, nationalityRaw, rawText) {
  const text = String(rawText || "").toUpperCase();

  if (text.includes("REFUGEE TRAVEL DOCUMENT") || nationalityRaw === "XXB") {
    return "Refugee / Protected Person Travel Document";
  }

  if (code === "PD") return "Diplomatic Passport";
  if (code === "PO") return "Official Passport";
  if (code === "PS") return "Service Passport";
  if (code === "PT") return "Travel Document";
  if (code === "PR") return "Refugee / Protected Person Travel Document";
  if (code.startsWith("P")) return "Passport";

  return detectDocumentTypeFromText(rawText);
}

function detectDocumentTypeFromText(text) {
  const value = String(text || "").toUpperCase();

  if (value.includes("REFUGEE TRAVEL DOCUMENT")) return "Refugee Travel Document";
  if (value.includes("TRAVEL DOCUMENT")) return "Travel Document";
  if (value.includes("DIPLOMATIC")) return "Diplomatic Passport";
  if (value.includes("SERVICE PASSPORT")) return "Service Passport";
  if (value.includes("OFFICIAL PASSPORT")) return "Official Passport";
  if (value.includes("PASSPORT")) return "Passport";

  return "Travel Document";
}

function normalizeNationality(value, rawText) {
  const code = String(value || "").toUpperCase().replace(/[^A-Z]/g, "");

  if (code === "XXA") return "Stateless person code / XXA";
  if (code === "XXB") return "Refugee travel document code / XXB";
  if (code === "XXC") return "Other protected person code / XXC";

  return code || extractVisibleNationality(rawText);
}

function extractVisibleNationality(text) {
  return extractTextValue(text, [
    /NATIONALITY[^A-Z0-9]*([A-Z]{3}|[A-Z ]{3,40})/i,
    /CITIZENSHIP[^A-Z0-9]*([A-Z]{3}|[A-Z ]{3,40})/i
  ]);
}

function detectIssuingCountry(text) {
  const value = String(text || "").toUpperCase();

  if (value.includes("CANADA")) return "CAN";
  if (value.includes("UNITED ARAB EMIRATES") || value.includes("UAE")) return "ARE";
  if (value.includes("UNITED STATES")) return "USA";
  if (value.includes("UNITED KINGDOM")) return "GBR";
  if (value.includes("SAUDI ARABIA")) return "SAU";
  if (value.includes("QATAR")) return "QAT";
  if (value.includes("KUWAIT")) return "KWT";
  if (value.includes("BAHRAIN")) return "BHR";
  if (value.includes("OMAN")) return "OMN";

  return "";
}

function extractVisibleDocumentNumber(text) {
  return extractTextValue(text, [
    /DOCUMENT\s*(NO|NUMBER)?[^A-Z0-9]*([A-Z0-9]{5,15})/i,
    /PASSPORT\s*(NO|NUMBER)?[^A-Z0-9]*([A-Z0-9]{5,15})/i
  ]);
}

function extractTextValue(text, patterns) {
  const normalized = String(text || "").toUpperCase();

  for (const pattern of patterns) {
    const match = normalized.match(pattern);

    if (match) {
      return cleanSimpleValue(match[2] || match[1]);
    }
  }

  return "";
}

function extractDateFromText(text, labels) {
  const normalized = String(text || "").toUpperCase();

  for (const label of labels) {
    const safe = escapeRegex(label);
    const pattern = new RegExp(
      `${safe}[^0-9A-Z]{0,25}(\\d{4}[/-]\\d{1,2}[/-]\\d{1,2}|\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}|\\d{1,2}\\s+[A-Z]{3,9}\\s+\\d{2,4})`,
      "i"
    );

    const match = normalized.match(pattern);

    if (match) return normalizeDate(match[1]);
  }

  return "";
}

function formatBirthDate(value) {
  if (!/^\d{6}$/.test(value)) return "";

  const yy = Number(value.slice(0, 2));
  const mm = value.slice(2, 4);
  const dd = value.slice(4, 6);
  const currentYY = new Date().getFullYear() % 100;
  const century = yy > currentYY ? 1900 : 2000;

  return `${century + yy}-${mm}-${dd}`;
}

function formatExpiryDate(value) {
  if (!/^\d{6}$/.test(value)) return "";

  const yy = Number(value.slice(0, 2));
  const mm = value.slice(2, 4);
  const dd = value.slice(4, 6);
  const currentYear = new Date().getFullYear();
  const currentCentury = Math.floor(currentYear / 100) * 100;

  let year = currentCentury + yy;

  if (year < currentYear - 5) year += 100;

  return `${year}-${mm}-${dd}`;
}

function normalizeDate(value) {
  const clean = String(value || "").trim().toUpperCase();

  const months = {
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
    const month = months[textDate[2]] || "";
    let year = textDate[3];

    if (year.length === 2) year = Number(year) > 40 ? `19${year}` : `20${year}`;

    return month ? `${year}-${month}-${day}` : "";
  }

  const parts = clean.replace(/[.]/g, "/").replace(/-/g, "/").split("/");

  if (parts.length !== 3) return "";

  let [a, b, c] = parts;

  if (a.length === 4) {
    return `${a}-${b.padStart(2, "0")}-${c.padStart(2, "0")}`;
  }

  if (c.length === 2) c = Number(c) > 40 ? `19${c}` : `20${c}`;

  return `${c}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`;
}

function normalizeGender(value) {
  const v = String(value || "").toUpperCase().trim();

  if (["M", "MALE"].includes(v)) return "M";
  if (["F", "FEMALE"].includes(v)) return "F";
  if (v === "X") return "X";

  return "";
}

function checkDigit(field, digit) {
  if (!digit || digit === "<") return false;

  const expected = computeCheckDigit(field);
  return String(expected) === String(digit);
}

function computeCheckDigit(input) {
  const weights = [7, 3, 1];

  const total = String(input || "")
    .toUpperCase()
    .split("")
    .reduce((sum, char, index) => {
      return sum + mrzCharValue(char) * weights[index % 3];
    }, 0);

  return total % 10;
}

function mrzCharValue(char) {
  if (char === "<") return 0;
  if (/[0-9]/.test(char)) return Number(char);
  if (/[A-Z]/.test(char)) return char.charCodeAt(0) - 55;
  return 0;
}

function buildConfidence(lines, format, nameConfidence) {
  const checks = [];

  if (format === "TD3" || format === "TD2") {
    const line2 = lines[1];
    checks.push(checkDigit(line2.slice(0, 9), line2[9]));
    checks.push(checkDigit(line2.slice(13, 19), line2[19]));
    checks.push(checkDigit(line2.slice(21, 27), line2[27]));
  }

  if (format === "TD1") {
    const line1 = lines[0];
    const line2 = lines[1];
    checks.push(checkDigit(line1.slice(5, 14), line1[14]));
    checks.push(checkDigit(line2.slice(0, 6), line2[6]));
    checks.push(checkDigit(line2.slice(8, 14), line2[14]));
  }

  const passed = checks.filter(Boolean).length;

  if (passed >= 3) return `Very High - ${format} MRZ check digits passed, ${nameConfidence}`;
  if (passed >= 2) return `High - ${format} MRZ mostly validated, ${nameConfidence}`;
  if (passed >= 1) return `Medium - ${format} MRZ partially validated, ${nameConfidence}`;

  return `Medium - ${format} MRZ detected but check digits not fully validated, ${nameConfidence}`;
}

function cleanSimpleValue(value) {
  return String(value || "")
    .replace(/[^A-Z0-9\s/-]/gi, "")
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