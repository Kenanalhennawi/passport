(function (window) {
  "use strict";

  window.PVV = window.PVV || {};

  const CHECK = window.PVV.CheckDigit;
  const COUNTRIES = window.PVV.Countries;

  const MAX_VARIANTS_PER_LINE = 24;

  const GENDER_MAP = {
    M: "MALE",
    F: "FEMALE",
    X: "UNSPECIFIED",
    "<": "UNSPECIFIED"
  };

  const DIGIT_OCR_MAP = {
    O: "0",
    Q: "0",
    D: "0",
    I: "1",
    L: "1",
    B: "8",
    S: "5",
    Z: "2",
    G: "6"
  };

  const BRACKET_LIKE_CHARS = /«|‹|≤|\{|\}|\[|\]|\(|\)|\||¦|!|\/|\\/g;

  const VISUAL_ZONE_NOISE_WORDS = [
    "SIGNATURE",
    "SIGHATURE",
    "DATE",
    "ISSUE",
    "EXPIRY",
    "EXPIRATION",
    "PLACE",
    "FATHER",
    "MOTHER",
    "PROFESSION",
    "OCCUPATION",
    "REPUBLIC",
    "PASSEPORT",
    "PASSPORT",
    "SURNAME",
    "GIVEN",
    "PRENOM",
    "NOM",
    "BIRTH",
    "CENTER",
    "CENTRE",
    "AUTHORITY"
  ];

  function parse(rawOcrText) {
    try {
      const rawLines = extractMrzLines(rawOcrText);
      const candidates = buildCandidates(rawLines);
      const best = selectBestCandidate(candidates);

      if (!best) {
        return emptyResult({
          warnings: ["MRZ not found or all MRZ candidates were rejected by validation."],
          rawOcrText,
          mrzRaw: rawLines,
          mrzCleaned: []
        });
      }

      if (best.format === "TD3") return parseTD3(best, rawOcrText);
      if (best.format === "TD2") return parseTD2(best, rawOcrText);
      if (best.format === "TD1") return parseTD1(best, rawOcrText);

      return emptyResult({
        warnings: ["Unsupported MRZ format."],
        rawOcrText,
        mrzRaw: rawLines,
        mrzCleaned: best.lines || []
      });
    } catch (error) {
      return emptyResult({
        warnings: [`MRZ parser error: ${error.message}`],
        rawOcrText,
        mrzRaw: [],
        mrzCleaned: []
      });
    }
  }

  function extractMrzLines(text) {
    return String(text || "")
      .toUpperCase()
      .split(/\r?\n/)
      .map((line) => normalizeRawOcrLine(line))
      .filter((line) => line.length >= 20)
      .filter((line) => isLikelyMrzFragment(line));
  }

  function normalizeRawOcrLine(line) {
    return String(line || "")
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(BRACKET_LIKE_CHARS, "<")
      .replace(/[^A-Z0-9<]/g, "");
  }

  function isLikelyMrzFragment(line) {
    const value = String(line || "");

    if (value.includes("<") && value.length >= 20) return true;
    if (/^[A-Z][A-Z0-9<][A-Z0-9<]{3}/.test(value) && value.length >= 25) return true;
    if (/[A-Z]{3}[0-9OBISZGL]{6}[0-9OBISZGL][MFX<][0-9OBISZGL]{6}/.test(value)) return true;
    if (/[0-9OBISZGL]{6}[0-9OBISZGL][MFX<][0-9OBISZGL]{6}/.test(value)) return true;

    return false;
  }

  function buildCandidates(rawLines) {
    const candidates = [];

    for (let i = 0; i < rawLines.length; i += 1) {
      const current = rawLines[i] || "";
      const next = rawLines[i + 1] || "";
      const third = rawLines[i + 2] || "";

      buildTD3Candidates(candidates, current, next);
      buildTD2Candidates(candidates, current, next);
      buildTD1Candidates(candidates, current, next, third);
    }

    return candidates;
  }

  function buildTD3Candidates(candidates, rawLine1, rawLine2) {
    const line1Variants = buildLineVariants(rawLine1, 44, "TD3_LINE1");
    const line2Variants = buildLineVariants(rawLine2, 44, "TD3_LINE2");

    for (const line1 of line1Variants) {
      for (const line2 of line2Variants) {
        const lines = [line1, line2];

        if (!looksLikeTD3(lines)) continue;

        const metrics = evaluateTD3(lines, [rawLine1, rawLine2]);
        const score = scoreTD3(lines, metrics);

        candidates.push({
          format: "TD3",
          raw: [rawLine1, rawLine2],
          lines,
          score,
          metrics
        });
      }
    }
  }

  function buildTD2Candidates(candidates, rawLine1, rawLine2) {
    const line1Variants = buildLineVariants(rawLine1, 36, "TD2_LINE1");
    const line2Variants = buildLineVariants(rawLine2, 36, "TD2_LINE2");

    for (const line1 of line1Variants) {
      for (const line2 of line2Variants) {
        const lines = [line1, line2];

        if (!looksLikeTD2(lines)) continue;

        const metrics = evaluateTD2(lines, [rawLine1, rawLine2]);
        const score = scoreTD2(lines, metrics);

        candidates.push({
          format: "TD2",
          raw: [rawLine1, rawLine2],
          lines,
          score,
          metrics
        });
      }
    }
  }

  function buildTD1Candidates(candidates, rawLine1, rawLine2, rawLine3) {
    const line1Variants = buildLineVariants(rawLine1, 30, "TD1_LINE1");
    const line2Variants = buildLineVariants(rawLine2, 30, "TD1_LINE2");
    const line3Variants = buildLineVariants(rawLine3, 30, "TD1_LINE3");

    for (const line1 of line1Variants) {
      for (const line2 of line2Variants) {
        for (const line3 of line3Variants) {
          const lines = [line1, line2, line3];

          if (!looksLikeTD1(lines)) continue;

          const metrics = evaluateTD1(lines, [rawLine1, rawLine2, rawLine3]);
          const score = scoreTD1(lines, metrics);

          candidates.push({
            format: "TD1",
            raw: [rawLine1, rawLine2, rawLine3],
            lines,
            score,
            metrics
          });
        }
      }
    }
  }

  function buildLineVariants(rawLine, targetLength, role) {
    const raw = normalizeRawOcrLine(rawLine);
    const variants = [];

    addVariant(variants, normalizeLength(raw, targetLength));

    if (isNameLineRole(role)) {
      addVariant(variants, repairNameLineBalanced(raw, targetLength));
      addVariant(variants, repairNameLineConservative(raw, targetLength));
      addVariant(variants, repairNameLineAggressive(raw, targetLength));
    }

    if (role === "TD3_LINE2") {
      buildDataLineVariants(variants, raw, targetLength, "TD3");
    }

    if (role === "TD2_LINE2") {
      buildDataLineVariants(variants, raw, targetLength, "TD2");
    }

    if (role === "TD1_LINE1") {
      addVariant(variants, repairTD1Line1(raw, targetLength));
      addDeletionVariants(variants, raw, targetLength, [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    }

    if (role === "TD1_LINE2") {
      addVariant(variants, repairTD1Line2(raw, targetLength));
      addDeletionVariants(variants, raw, targetLength, [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14]);
    }

    return variants.slice(0, MAX_VARIANTS_PER_LINE);
  }

  function isNameLineRole(role) {
    return role === "TD3_LINE1" || role === "TD2_LINE1" || role === "TD1_LINE3";
  }

  function buildDataLineVariants(variants, raw, targetLength, format) {
    addVariant(variants, repairDataLine(raw, targetLength, format));

    const usefulPositions = format === "TD3"
      ? buildDeletionPositionsForTD3(raw)
      : buildDeletionPositionsForTD2(raw);

    addDeletionVariants(variants, raw, targetLength, usefulPositions);

    if (raw.length > targetLength) {
      for (let i = 0; i < raw.length; i += 1) {
        const deleted = raw.slice(0, i) + raw.slice(i + 1);
        addVariant(variants, repairDataLine(deleted, targetLength, format));
      }
    }
  }

  function buildDeletionPositionsForTD3(raw) {
    const positions = [];

    for (let i = 0; i < raw.length; i += 1) {
      if (i >= 10 && i <= 20) positions.push(i);
      if (i >= 21 && i <= 31) positions.push(i);
      if (i >= 32 && i <= 44) positions.push(i);
    }

    return positions;
  }

  function buildDeletionPositionsForTD2(raw) {
    const positions = [];

    for (let i = 0; i < raw.length; i += 1) {
      if (i >= 10 && i <= 20) positions.push(i);
      if (i >= 21 && i <= 35) positions.push(i);
    }

    return positions;
  }

  function addDeletionVariants(variants, raw, targetLength, positions) {
    const source = normalizeRawOcrLine(raw);

    if (source.length <= targetLength) return;

    for (const position of positions) {
      if (position < 0 || position >= source.length) continue;

      const deleted = source.slice(0, position) + source.slice(position + 1);
      addVariant(variants, normalizeLength(deleted, targetLength));
    }
  }

  function addVariant(list, value) {
    if (!value) return;

    if (!list.includes(value)) {
      list.push(value);
    }
  }

  function normalizeLength(value, targetLength) {
    let line = String(value || "")
      .toUpperCase()
      .replace(/\s+/g, "")
      .replace(BRACKET_LIKE_CHARS, "<")
      .replace(/[^A-Z0-9<]/g, "");

    if (line.length > targetLength) line = line.slice(0, targetLength);

    return line.padEnd(targetLength, "<");
  }

  function repairNameLineBalanced(rawLine, targetLength) {
    const value = normalizeRawOcrLine(rawLine);

    if (value.length < 5) return normalizeLength(value, targetLength);

    const prefix = value.slice(0, 5);
    let nameZone = value.slice(5);

    nameZone = repairNameZoneSeparators(nameZone, "balanced");

    return normalizeLength(prefix + nameZone, targetLength);
  }

  function repairNameLineConservative(rawLine, targetLength) {
    const value = normalizeRawOcrLine(rawLine);

    if (value.length < 5) return normalizeLength(value, targetLength);

    const prefix = value.slice(0, 5);
    let nameZone = value.slice(5);

    nameZone = nameZone.replace(/<{3,}/g, "<<");
    nameZone = nameZone.replace(/[KLISZ]{3,}/g, "<<");
    nameZone = nameZone.replace(/C{4,}/g, "<<");
    nameZone = nameZone.replace(/[<KLISZC]{8,}$/g, "<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<");

    return normalizeLength(prefix + nameZone, targetLength);
  }

  function repairNameLineAggressive(rawLine, targetLength) {
    const value = normalizeRawOcrLine(rawLine);

    if (value.length < 5) return normalizeLength(value, targetLength);

    const prefix = value.slice(0, 5);
    let nameZone = value.slice(5);

    nameZone = repairNameZoneSeparators(nameZone, "aggressive");

    return normalizeLength(prefix + nameZone, targetLength);
  }

  function repairNameZoneSeparators(nameZone, mode) {
    let zone = String(nameZone || "")
      .toUpperCase()
      .replace(/[^A-Z<]/g, "");

    zone = zone.replace(/<{3,}/g, "<<");
    zone = zone.replace(/[KLISZ]{3,}/g, "<<");
    zone = zone.replace(/C{3,}/g, "<<");

    zone = zone.replace(/([A-Z])([<KLISZC]{2,})([A-Z])/g, (match, before, separator, after) => {
      if (separator.includes("<")) return `${before}<<${after}`;
      if (/^[KLISZ]{2,}$/.test(separator)) return `${before}<<${after}`;
      if (/^C{3,}$/.test(separator)) return `${before}<<${after}`;
      if (mode === "aggressive" && separator.length >= 4) return `${before}<<${after}`;

      return match;
    });

    zone = zone.replace(/[<KLISZC]{7,}$/g, "<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<");
    zone = zone.replace(/<{3,}/g, "<<");

    return zone;
  }

  function repairDataLine(rawLine, targetLength, format) {
    let line = normalizeLength(rawLine, targetLength);

    if (format === "TD3") {
      line = replaceRange(line, 9, 10, forceDigits(line.slice(9, 10)));
      line = replaceRange(line, 13, 20, forceDigits(line.slice(13, 20)));
      line = replaceRange(line, 21, 28, forceDigits(line.slice(21, 28)));
      line = replaceRange(line, 43, 44, forceDigits(line.slice(43, 44)));
    }

    if (format === "TD2") {
      line = replaceRange(line, 9, 10, forceDigits(line.slice(9, 10)));
      line = replaceRange(line, 13, 20, forceDigits(line.slice(13, 20)));
      line = replaceRange(line, 21, 28, forceDigits(line.slice(21, 28)));
      line = replaceRange(line, 35, 36, forceDigits(line.slice(35, 36)));
    }

    return normalizeLength(line, targetLength);
  }

  function repairTD1Line1(rawLine, targetLength) {
    let line = normalizeLength(rawLine, targetLength);

    line = replaceRange(line, 14, 15, forceDigits(line.slice(14, 15)));

    return normalizeLength(line, targetLength);
  }

  function repairTD1Line2(rawLine, targetLength) {
    let line = normalizeLength(rawLine, targetLength);

    line = replaceRange(line, 0, 7, forceDigits(line.slice(0, 7)));
    line = replaceRange(line, 8, 15, forceDigits(line.slice(8, 15)));
    line = replaceRange(line, 29, 30, forceDigits(line.slice(29, 30)));

    return normalizeLength(line, targetLength);
  }

  function forceDigits(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/[OQDILBSZG]/g, (char) => DIGIT_OCR_MAP[char] || char)
      .replace(/</g, "0");
  }

  function replaceRange(value, start, end, replacement) {
    const source = String(value || "");
    const length = end - start;
    const cleanReplacement = String(replacement || "").slice(0, length).padEnd(length, "<");

    return source.slice(0, start) + cleanReplacement + source.slice(end);
  }

  function selectBestCandidate(candidates) {
    if (!Array.isArray(candidates) || !candidates.length) return null;

    const acceptable = candidates
      .filter(isAcceptableCandidate)
      .sort((a, b) => b.score - a.score);

    return acceptable[0] || null;
  }

  function isAcceptableCandidate(candidate) {
    if (!candidate || !candidate.metrics) return false;

    const metrics = candidate.metrics;
    const score = Number(candidate.score || 0);

    if (metrics.visualNoise) return false;
    if (metrics.allChecksFailed) return false;
    if (metrics.invalidDate) return false;

    if (candidate.format === "TD1") {
      if (score < 80) return false;
      if (metrics.validChecks < 2) return false;
      if (metrics.unknownIssuingCountry) return false;
      if (metrics.unknownNationality) return false;
      if (metrics.unknownDocumentType) return false;
    }

    if (candidate.format === "TD2") {
      if (score < 70) return false;
      if (metrics.validChecks < 2) return false;
      if (metrics.unknownIssuingCountry && score < 95) return false;
      if (metrics.unknownDocumentType && score < 95) return false;
    }

    if (candidate.format === "TD3") {
      if (score < 70) return false;
      if (metrics.validChecks < 2) return false;
      if (metrics.unknownIssuingCountry && score < 95) return false;
      if (metrics.unknownDocumentType && score < 95) return false;
    }

    return true;
  }

  function looksLikeTD3(lines) {
    return lines[0].length === 44 &&
      lines[1].length === 44 &&
      /^[A-Z][A-Z<][A-Z]{3}/.test(lines[0]) &&
      /\d{6}/.test(lines[1].slice(13, 19)) &&
      /\d{6}/.test(lines[1].slice(21, 27));
  }

  function looksLikeTD2(lines) {
    return lines[0].length === 36 &&
      lines[1].length === 36 &&
      /^[A-Z][A-Z<][A-Z]{3}/.test(lines[0]) &&
      /\d{6}/.test(lines[1].slice(13, 19)) &&
      /\d{6}/.test(lines[1].slice(21, 27));
  }

  function looksLikeTD1(lines) {
    return lines[0].length === 30 &&
      lines[1].length === 30 &&
      lines[2].length === 30 &&
      /^[A-Z][A-Z<][A-Z]{3}/.test(lines[0]) &&
      /\d{6}/.test(lines[1].slice(0, 6)) &&
      /\d{6}/.test(lines[1].slice(8, 14));
  }

  function evaluateTD3(lines, rawLines) {
    const line1 = lines[0];
    const line2 = lines[1];

    const docNumberValid = safeValidate(line2.slice(0, 9), line2[9]);
    const dobValid = safeValidate(line2.slice(13, 19), line2[19]);
    const expiryValid = safeValidate(line2.slice(21, 27), line2[27]);
    const compositeValid = validateTD3Composite(line2);

    const dobISO = mrzDateToISO(line2.slice(13, 19), "birth");
    const expiryISO = mrzDateToISO(line2.slice(21, 27), "expiry");

    const documentType = mapDocumentType(line1.slice(0, 2).replace(/</g, ""));
    const issuingCode = line1.slice(2, 5).replace(/</g, "");
    const nationalityCode = line2.slice(10, 13).replace(/</g, "");

    const validChecks = countTrue([docNumberValid, dobValid, expiryValid, compositeValid]);

    return {
      validChecks,
      allChecksFailed: validChecks === 0,
      docNumberValid,
      dobValid,
      expiryValid,
      compositeValid,
      invalidDate: !isValidISODate(dobISO, "birth") || !isValidISODate(expiryISO, "expiry"),
      unknownDocumentType: documentType.type === "UNKNOWN",
      unknownIssuingCountry: !COUNTRIES.isKnownCode(issuingCode),
      unknownNationality: !COUNTRIES.isKnownCode(nationalityCode),
      visualNoise: containsVisualZoneNoise(rawLines),
      genderValid: ["M", "F", "X", "<"].includes(line2[20])
    };
  }

  function evaluateTD2(lines, rawLines) {
    const line1 = lines[0];
    const line2 = lines[1];

    const docNumberValid = safeValidate(line2.slice(0, 9), line2[9]);
    const dobValid = safeValidate(line2.slice(13, 19), line2[19]);
    const expiryValid = safeValidate(line2.slice(21, 27), line2[27]);
    const compositeValid = validateTD2Composite(line2);

    const dobISO = mrzDateToISO(line2.slice(13, 19), "birth");
    const expiryISO = mrzDateToISO(line2.slice(21, 27), "expiry");

    const documentType = mapDocumentType(line1.slice(0, 2).replace(/</g, ""));
    const issuingCode = line1.slice(2, 5).replace(/</g, "");
    const nationalityCode = line2.slice(10, 13).replace(/</g, "");

    const validChecks = countTrue([docNumberValid, dobValid, expiryValid, compositeValid]);

    return {
      validChecks,
      allChecksFailed: validChecks === 0,
      docNumberValid,
      dobValid,
      expiryValid,
      compositeValid,
      invalidDate: !isValidISODate(dobISO, "birth") || !isValidISODate(expiryISO, "expiry"),
      unknownDocumentType: documentType.type === "UNKNOWN",
      unknownIssuingCountry: !COUNTRIES.isKnownCode(issuingCode),
      unknownNationality: !COUNTRIES.isKnownCode(nationalityCode),
      visualNoise: containsVisualZoneNoise(rawLines),
      genderValid: ["M", "F", "X", "<"].includes(line2[20])
    };
  }

  function evaluateTD1(lines, rawLines) {
    const line1 = lines[0];
    const line2 = lines[1];
    const line3 = lines[2];

    const docNumberValid = safeValidate(line1.slice(5, 14), line1[14]);
    const dobValid = safeValidate(line2.slice(0, 6), line2[6]);
    const expiryValid = safeValidate(line2.slice(8, 14), line2[14]);
    const compositeValid = validateTD1Composite(line1, line2, line3);

    const dobISO = mrzDateToISO(line2.slice(0, 6), "birth");
    const expiryISO = mrzDateToISO(line2.slice(8, 14), "expiry");

    const documentType = mapDocumentType(line1.slice(0, 2).replace(/</g, ""));
    const issuingCode = line1.slice(2, 5).replace(/</g, "");
    const nationalityCode = line2.slice(15, 18).replace(/</g, "");

    const validChecks = countTrue([docNumberValid, dobValid, expiryValid, compositeValid]);

    return {
      validChecks,
      allChecksFailed: validChecks === 0,
      docNumberValid,
      dobValid,
      expiryValid,
      compositeValid,
      invalidDate: !isValidISODate(dobISO, "birth") || !isValidISODate(expiryISO, "expiry"),
      unknownDocumentType: documentType.type === "UNKNOWN",
      unknownIssuingCountry: !COUNTRIES.isKnownCode(issuingCode),
      unknownNationality: !COUNTRIES.isKnownCode(nationalityCode),
      visualNoise: containsVisualZoneNoise(rawLines),
      genderValid: ["M", "F", "X", "<"].includes(line2[7])
    };
  }

  function scoreTD3(lines, metrics) {
    const line1 = lines[0];
    let score = 0;

    if (/^[A-Z][A-Z<][A-Z]{3}/.test(line1)) score += 10;
    if (line1.includes("<<")) score += 20;
    if (metrics.docNumberValid) score += 25;
    if (metrics.dobValid) score += 25;
    if (metrics.expiryValid) score += 25;
    if (metrics.compositeValid) score += 30;
    if (metrics.genderValid) score += 5;
    if (!metrics.unknownDocumentType) score += 10;
    if (!metrics.unknownIssuingCountry) score += 10;
    if (!metrics.unknownNationality) score += 10;
    if (metrics.invalidDate) score -= 40;
    if (metrics.visualNoise) score -= 80;
    if (metrics.allChecksFailed) score -= 100;

    return Math.max(0, score);
  }

  function scoreTD2(lines, metrics) {
    const line1 = lines[0];
    let score = 0;

    if (/^[A-Z][A-Z<][A-Z]{3}/.test(line1)) score += 10;
    if (line1.includes("<<")) score += 20;
    if (metrics.docNumberValid) score += 20;
    if (metrics.dobValid) score += 20;
    if (metrics.expiryValid) score += 20;
    if (metrics.compositeValid) score += 25;
    if (metrics.genderValid) score += 5;
    if (!metrics.unknownDocumentType) score += 10;
    if (!metrics.unknownIssuingCountry) score += 10;
    if (!metrics.unknownNationality) score += 10;
    if (metrics.invalidDate) score -= 40;
    if (metrics.visualNoise) score -= 80;
    if (metrics.allChecksFailed) score -= 100;

    return Math.max(0, score);
  }

  function scoreTD1(lines, metrics) {
    const line1 = lines[0];
    const line3 = lines[2];
    let score = 0;

    if (/^[A-Z][A-Z<][A-Z]{3}/.test(line1)) score += 10;
    if (line3.includes("<<")) score += 15;
    if (metrics.docNumberValid) score += 20;
    if (metrics.dobValid) score += 20;
    if (metrics.expiryValid) score += 20;
    if (metrics.compositeValid) score += 25;
    if (metrics.genderValid) score += 5;
    if (!metrics.unknownDocumentType) score += 10;
    if (!metrics.unknownIssuingCountry) score += 10;
    if (!metrics.unknownNationality) score += 10;
    if (metrics.invalidDate) score -= 40;
    if (metrics.visualNoise) score -= 100;
    if (metrics.allChecksFailed) score -= 100;

    return Math.max(0, score);
  }

  function containsVisualZoneNoise(rawLines) {
    const joined = String((rawLines || []).join(" ")).toUpperCase();

    return VISUAL_ZONE_NOISE_WORDS.some((word) => joined.includes(word));
  }

  function safeValidate(value, digit) {
    try {
      return Boolean(CHECK.validate(value, digit));
    } catch {
      return false;
    }
  }

  function countTrue(values) {
    return values.filter(Boolean).length;
  }

  function parseTD3(candidate, rawOcrText) {
    const line1 = candidate.lines[0];
    const line2 = candidate.lines[1];
    const corrections = [];
    const warnings = [];

    const docNumberResult = correctField("documentNumber", line2.slice(0, 9), line2[9], "document");
    const dobResult = correctField("dateOfBirth", line2.slice(13, 19), line2[19], "date");
    const expiryResult = correctField("expiryDate", line2.slice(21, 27), line2[27], "date");

    corrections.push(...docNumberResult.corrections, ...dobResult.corrections, ...expiryResult.corrections);

    const checkDigits = {
      documentNumber: docNumberResult.valid,
      dateOfBirth: dobResult.valid,
      expiryDate: expiryResult.valid,
      composite: validateTD3Composite(line2),
      allValid: false
    };

    checkDigits.allValid = checkDigits.documentNumber &&
      checkDigits.dateOfBirth &&
      checkDigits.expiryDate &&
      checkDigits.composite;

    const docType = mapDocumentType(line1.slice(0, 2).replace(/</g, ""));
    const issuingCode = line1.slice(2, 5).replace(/</g, "");
    const nationalityCode = line2.slice(10, 13).replace(/</g, "");
    const name = parseName(line1.slice(5));

    if (name.nameWarnings && name.nameWarnings.length) {
      warnings.push(...name.nameWarnings);
    }

    return buildResult({
      documentType: docType.type,
      documentSubtype: docType.subtype,
      mrzFormat: "TD3",
      surname: name.surname,
      givenNames: name.givenNames,
      nameConfidence: name.nameConfidence,
      nameWarnings: name.nameWarnings,
      removedNameNoiseTokens: name.removedNoiseTokens,
      nationalityCode,
      dateOfBirth: mrzDateToISO(dobResult.value, "birth"),
      gender: normalizeGender(line2[20]),
      documentNumber: docNumberResult.value.replace(/</g, ""),
      issuingCountryCode: issuingCode,
      issueDate: null,
      expiryDate: mrzDateToISO(expiryResult.value, "expiry"),
      checkDigits,
      corrections,
      warnings,
      mrzRaw: candidate.raw,
      mrzCleaned: candidate.lines,
      rawOcrText
    });
  }

  function parseTD2(candidate, rawOcrText) {
    const line1 = candidate.lines[0];
    const line2 = candidate.lines[1];
    const corrections = [];
    const warnings = [];

    const docNumberResult = correctField("documentNumber", line2.slice(0, 9), line2[9], "document");
    const dobResult = correctField("dateOfBirth", line2.slice(13, 19), line2[19], "date");
    const expiryResult = correctField("expiryDate", line2.slice(21, 27), line2[27], "date");

    corrections.push(...docNumberResult.corrections, ...dobResult.corrections, ...expiryResult.corrections);

    const checkDigits = {
      documentNumber: docNumberResult.valid,
      dateOfBirth: dobResult.valid,
      expiryDate: expiryResult.valid,
      composite: validateTD2Composite(line2),
      allValid: false
    };

    checkDigits.allValid = checkDigits.documentNumber &&
      checkDigits.dateOfBirth &&
      checkDigits.expiryDate &&
      checkDigits.composite;

    const docType = mapDocumentType(line1.slice(0, 2).replace(/</g, ""));
    const issuingCode = line1.slice(2, 5).replace(/</g, "");
    const nationalityCode = line2.slice(10, 13).replace(/</g, "");
    const name = parseName(line1.slice(5));

    if (name.nameWarnings && name.nameWarnings.length) {
      warnings.push(...name.nameWarnings);
    }

    return buildResult({
      documentType: docType.type,
      documentSubtype: docType.subtype,
      mrzFormat: "TD2",
      surname: name.surname,
      givenNames: name.givenNames,
      nameConfidence: name.nameConfidence,
      nameWarnings: name.nameWarnings,
      removedNameNoiseTokens: name.removedNoiseTokens,
      nationalityCode,
      dateOfBirth: mrzDateToISO(dobResult.value, "birth"),
      gender: normalizeGender(line2[20]),
      documentNumber: docNumberResult.value.replace(/</g, ""),
      issuingCountryCode: issuingCode,
      issueDate: null,
      expiryDate: mrzDateToISO(expiryResult.value, "expiry"),
      checkDigits,
      corrections,
      warnings,
      mrzRaw: candidate.raw,
      mrzCleaned: candidate.lines,
      rawOcrText
    });
  }

  function parseTD1(candidate, rawOcrText) {
    const line1 = candidate.lines[0];
    const line2 = candidate.lines[1];
    const line3 = candidate.lines[2];
    const corrections = [];
    const warnings = [];

    const docNumberResult = correctField("documentNumber", line1.slice(5, 14), line1[14], "document");
    const dobResult = correctField("dateOfBirth", line2.slice(0, 6), line2[6], "date");
    const expiryResult = correctField("expiryDate", line2.slice(8, 14), line2[14], "date");

    corrections.push(...docNumberResult.corrections, ...dobResult.corrections, ...expiryResult.corrections);

    const checkDigits = {
      documentNumber: docNumberResult.valid,
      dateOfBirth: dobResult.valid,
      expiryDate: expiryResult.valid,
      composite: validateTD1Composite(line1, line2, line3),
      allValid: false
    };

    checkDigits.allValid = checkDigits.documentNumber &&
      checkDigits.dateOfBirth &&
      checkDigits.expiryDate &&
      checkDigits.composite;

    const docType = mapDocumentType(line1.slice(0, 2).replace(/</g, ""));
    const issuingCode = line1.slice(2, 5).replace(/</g, "");
    const nationalityCode = line2.slice(15, 18).replace(/</g, "");
    const name = parseName(line3);

    if (name.nameWarnings && name.nameWarnings.length) {
      warnings.push(...name.nameWarnings);
    }

    return buildResult({
      documentType: docType.type,
      documentSubtype: docType.subtype,
      mrzFormat: "TD1",
      surname: name.surname,
      givenNames: name.givenNames,
      nameConfidence: name.nameConfidence,
      nameWarnings: name.nameWarnings,
      removedNameNoiseTokens: name.removedNoiseTokens,
      nationalityCode,
      dateOfBirth: mrzDateToISO(dobResult.value, "birth"),
      gender: normalizeGender(line2[7]),
      documentNumber: docNumberResult.value.replace(/</g, ""),
      issuingCountryCode: issuingCode,
      issueDate: null,
      expiryDate: mrzDateToISO(expiryResult.value, "expiry"),
      checkDigits,
      corrections,
      warnings,
      mrzRaw: candidate.raw,
      mrzCleaned: candidate.lines,
      rawOcrText
    });
  }

  function correctField(field, value, digit, type) {
    const result = CHECK.correctWithCheckDigit(value, digit, type);

    return {
      value: result.value,
      valid: result.valid,
      corrections: result.corrections.map(() => CHECK.correctionRecord(
        field,
        value,
        result.value
      ))
    };
  }

  function parseName(nameZone) {
    if (
      window.PVV &&
      window.PVV.NameParser &&
      typeof window.PVV.NameParser.parseMrzNameGlobal === "function"
    ) {
      const parsed = window.PVV.NameParser.parseMrzNameGlobal(nameZone);

      return {
        surname: parsed.surname,
        givenNames: parsed.givenNames,
        removedNoiseTokens: parsed.removedNoiseTokens,
        nameConfidence: parsed.confidence,
        nameWarnings: parsed.warnings
      };
    }

    let zone = String(nameZone || "")
      .toUpperCase()
      .replace(/[^A-Z<]/g, "<")
      .replace(/<{3,}/g, "<<");

    const separatorIndex = zone.indexOf("<<");

    if (separatorIndex >= 0) {
      return {
        surname: mrzNameToText(zone.slice(0, separatorIndex)),
        givenNames: mrzNameToText(zone.slice(separatorIndex + 2)),
        removedNoiseTokens: [],
        nameConfidence: {
          score: 70,
          grade: "MEDIUM",
          reasons: ["Fallback MRZ name parser used."]
        },
        nameWarnings: []
      };
    }

    const parts = zone.split("<").filter(Boolean);

    return {
      surname: mrzNameToText(parts[0] || ""),
      givenNames: mrzNameToText(parts.slice(1).join("<")),
      removedNoiseTokens: [],
      nameConfidence: {
        score: 50,
        grade: "LOW",
        reasons: ["Fallback parser used without primary separator."]
      },
      nameWarnings: ["MRZ primary name separator was not found."]
    };
  }

  function mrzNameToText(value) {
    const alpha = CHECK.correctAlphaField(value || "").corrected;

    return alpha
      .replace(/</g, " ")
      .replace(/\b[KLI]{4,}\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function validateTD3Composite(line2) {
    const compositeField =
      line2.slice(0, 10) +
      line2.slice(13, 20) +
      line2.slice(21, 43);

    return safeValidate(compositeField, line2[43]);
  }

  function validateTD2Composite(line2) {
    if (!line2[35]) return false;

    const compositeField =
      line2.slice(0, 10) +
      line2.slice(13, 20) +
      line2.slice(21, 35);

    return safeValidate(compositeField, line2[35]);
  }

  function validateTD1Composite(line1, line2, line3) {
    const compositeField =
      line1.slice(5, 30) +
      line2.slice(0, 7) +
      line2.slice(8, 15) +
      line2.slice(18, 29);

    return safeValidate(compositeField, line2[29] || line3[29]);
  }

  function mapDocumentType(code) {
    const normalized = String(code || "").toUpperCase();

    const map = {
      P: ["PASSPORT", "STANDARD"],
      PN: ["PASSPORT", "STANDARD"],
      PD: ["PASSPORT", "DIPLOMATIC"],
      PS: ["PASSPORT", "SERVICE"],
      PO: ["PASSPORT", "OFFICIAL"],
      PT: ["TRAVEL_DOCUMENT", "TRAVEL_DOCUMENT"],
      PR: ["TRAVEL_DOCUMENT", "REFUGEE"],
      IP: ["IDENTITY_CARD", "PASSPORT_CARD"],
      I: ["IDENTITY_CARD", "STANDARD"],
      ID: ["IDENTITY_CARD", "STANDARD"],
      C: ["IDENTITY_CARD", "STANDARD"],
      A: ["IDENTITY_CARD", "STANDARD"],
      V: ["VISA", "STANDARD"]
    };

    const result = map[normalized] || map[normalized[0]] || ["UNKNOWN", "UNKNOWN"];

    return {
      type: result[0],
      subtype: result[1]
    };
  }

  function normalizeGender(value) {
    return GENDER_MAP[String(value || "").toUpperCase()] || "UNSPECIFIED";
  }

  function mrzDateToISO(value, mode) {
    if (!/^\d{6}$/.test(value)) return "";

    const yy = Number(value.slice(0, 2));
    const mm = value.slice(2, 4);
    const dd = value.slice(4, 6);
    const currentYear = new Date().getFullYear();
    const currentYY = currentYear % 100;

    let century;

    if (mode === "expiry") {
      century = Math.floor(currentYear / 100) * 100;
      if (century + yy < currentYear - 5) century += 100;
    } else {
      century = yy > currentYY ? 1900 : 2000;
    }

    return `${century + yy}-${mm}-${dd}`;
  }

  function isValidISODate(value, mode) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));

    if (month < 1 || month > 12) return false;
    if (day < 1 || day > 31) return false;

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return false;

    if (date.getUTCFullYear() !== year) return false;
    if (date.getUTCMonth() + 1 !== month) return false;
    if (date.getUTCDate() !== day) return false;

    const currentYear = new Date().getFullYear();

    if (mode === "birth") {
      if (year < 1900 || year > currentYear) return false;
    }

    if (mode === "expiry") {
      if (year < currentYear - 30 || year > currentYear + 30) return false;
    }

    return true;
  }

  function expiryStatus(expiryDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const expiry = new Date(expiryDate);

    if (!expiryDate || Number.isNaN(expiry.getTime())) {
      return {
        expired: false,
        status: "UNKNOWN",
        daysUntilExpiry: null,
        daysExpired: null
      };
    }

    expiry.setHours(0, 0, 0, 0);

    const diff = Math.round((expiry.getTime() - today.getTime()) / 86400000);

    if (diff < 0) {
      return {
        expired: true,
        status: "EXPIRED",
        daysUntilExpiry: null,
        daysExpired: Math.abs(diff)
      };
    }

    if (diff <= 30) {
      return {
        expired: false,
        status: "EXPIRING_SOON",
        daysUntilExpiry: diff,
        daysExpired: null
      };
    }

    return {
      expired: false,
      status: "VALID",
      daysUntilExpiry: diff,
      daysExpired: null
    };
  }

  function buildResult(input) {
    const nationality = COUNTRIES.getCountryName(input.nationalityCode);
    const issuingCountry = COUNTRIES.getCountryName(input.issuingCountryCode);
    const expiry = expiryStatus(input.expiryDate);
    const confidence = buildConfidence(input, expiry);

    const warnings = input.warnings || [];

    if (input.nameWarnings && input.nameWarnings.length) {
      warnings.push(...input.nameWarnings);
    }

    if (!input.surname || !input.givenNames) warnings.push("Name is incomplete.");
    if (!COUNTRIES.isKnownCode(input.nationalityCode)) warnings.push("Nationality code is not recognized.");
    if (!COUNTRIES.isKnownCode(input.issuingCountryCode)) warnings.push("Issuing country code is not recognized.");
    if (expiry.status === "EXPIRED") warnings.push("Document is expired.");
    if (expiry.status === "EXPIRING_SOON") warnings.push("Document expires within 30 days.");
    if (!input.checkDigits.allValid) warnings.push("One or more MRZ check digits failed.");

    return {
      documentType: input.documentType,
      documentSubtype: input.documentSubtype,
      mrzFormat: input.mrzFormat,

      surname: input.surname,
      givenNames: input.givenNames,
      fullName: `${input.givenNames} ${input.surname}`.replace(/\s+/g, " ").trim(),
      nameConfidence: input.nameConfidence || null,
      removedNameNoiseTokens: input.removedNameNoiseTokens || [],

      nationality,
      nationalityCode: input.nationalityCode,
      dateOfBirth: input.dateOfBirth,
      gender: input.gender,

      documentNumber: input.documentNumber,
      issuingCountry,
      issuingCountryCode: input.issuingCountryCode,
      issueDate: input.issueDate,
      expiryDate: input.expiryDate,

      expiryStatus: expiry,
      checkDigits: input.checkDigits,
      confidence,
      corrections: input.corrections,
      warnings,

      mrzRaw: input.mrzRaw,
      mrzCleaned: input.mrzCleaned,
      rawOcrText: input.rawOcrText,
      parsedAt: new Date().toISOString()
    };
  }

  function buildConfidence(input, expiry) {
    let score = 0;
    const breakdown = [];

    if (input.mrzFormat !== "NONE") {
      score += 40;
      breakdown.push("+40 MRZ detected and parsed");
    } else {
      score -= 20;
      breakdown.push("-20 MRZ not found");
    }

    if (input.checkDigits.allValid) {
      score += 20;
      breakdown.push("+20 all check digits valid");
    } else {
      score -= 10;
      breakdown.push("-10 one or more check digits failed");
    }

    if (expiry.status === "VALID") {
      score += 15;
      breakdown.push("+15 expiry date valid");
    }

    if (input.nameConfidence) {
      if (input.nameConfidence.score >= 90) {
        score += 10;
        breakdown.push("+10 name parsed successfully (HIGH confidence)");
      } else if (input.nameConfidence.score >= 70) {
        score += 7;
        breakdown.push("+7 name parsed successfully (MEDIUM confidence)");
      } else {
        score += 3;
        breakdown.push("+3 name parsed successfully (LOW confidence)");
      }
    } else if (input.surname && input.givenNames) {
      score += 10;
      breakdown.push("+10 name parsed successfully");
    }

    if (COUNTRIES.isKnownCode(input.nationalityCode)) {
      score += 10;
      breakdown.push("+10 country code recognized");
    }

    if (input.documentType !== "UNKNOWN") {
      score += 5;
      breakdown.push("+5 document type identified");
    }

    if (input.corrections.length) {
      const penalty = input.corrections.length * 5;
      score -= penalty;
      breakdown.push(`-${penalty} OCR correction penalty`);
    }

    score = Math.max(0, Math.min(100, score));

    return {
      score,
      grade: score >= 85 ? "HIGH" : score >= 60 ? "MEDIUM" : "LOW",
      breakdown
    };
  }

  function emptyResult(options) {
    return {
      documentType: "UNKNOWN",
      documentSubtype: "UNKNOWN",
      mrzFormat: "NONE",
      surname: "",
      givenNames: "",
      fullName: "",
      nationality: "",
      nationalityCode: "",
      dateOfBirth: "",
      gender: "UNSPECIFIED",
      documentNumber: "",
      issuingCountry: "",
      issuingCountryCode: "",
      issueDate: null,
      expiryDate: "",
      expiryStatus: {
        expired: false,
        status: "UNKNOWN",
        daysUntilExpiry: null,
        daysExpired: null
      },
      checkDigits: {
        documentNumber: false,
        dateOfBirth: false,
        expiryDate: false,
        composite: false,
        allValid: false
      },
      confidence: {
        score: 0,
        grade: "LOW",
        breakdown: ["MRZ not parsed"]
      },
      corrections: [],
      warnings: options.warnings || [],
      mrzRaw: options.mrzRaw || [],
      mrzCleaned: options.mrzCleaned || [],
      rawOcrText: options.rawOcrText || "",
      parsedAt: new Date().toISOString()
    };
  }

  window.PVV.MRZParser = {
    parse,
    extractMrzLines,
    parseName,
    mrzDateToISO,
    expiryStatus,
    mapDocumentType
  };
})(window);
