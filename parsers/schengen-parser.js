(function (window) {
  "use strict";

  window.PVV = window.PVV || {};
  window.PVV.Parsers = window.PVV.Parsers || {};

  const FIELD_PATTERNS = {
    visaType: [
      /\bTYPE\s+OF\s+VISA\s*[:\-]?\s*([ABCD])/i,
      /\bTYPE\s*[:\-]?\s*([ABCD])\b/i
    ],
    validFor: [
      /\bVALID\s+FOR\s*[:\-]?\s*([A-Z\s]+)/i,
      /\bVALABLE\s+POUR\s*[:\-]?\s*([A-Z\s]+)/i
    ],
    validFrom: [
      /\bFROM\s*[:\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
      /\bVALID\s+FROM\s*[:\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i
    ],
    validUntil: [
      /\bUNTIL\s*[:\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i,
      /\bVALID\s+UNTIL\s*[:\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/i
    ],
    entries: [
      /\bNUMBER\s+OF\s+ENTRIES\s*[:\-]?\s*(MULT|MULTIPLE|[0-9]{1,2})/i,
      /\bENTRIES\s*[:\-]?\s*(MULT|MULTIPLE|[0-9]{1,2})/i
    ],
    duration: [
      /\bDURATION\s+OF\s+STAY\s*[:\-]?\s*([0-9]{1,3})/i,
      /\bDURATION\s*[:\-]?\s*([0-9]{1,3})/i
    ],
    issuingPost: [
      /\bISSUED\s+IN\s*[:\-]?\s*([A-Z\s]+)/i,
      /\bISSUING\s+AUTHORITY\s*[:\-]?\s*([A-Z\s]+)/i
    ],
    remarks: [
      /\bREMARKS\s*[:\-]?\s*([A-Z0-9\s/-]+)/i,
      /\bOBSERVATIONS\s*[:\-]?\s*([A-Z0-9\s/-]+)/i
    ],
    passportNumber: [
      /\bPASSPORT\s*(NO|NUMBER)?\s*[:\-]?\s*([A-Z0-9]{5,20})/i
    ],
    surname: [
      /\bSURNAME\s*[:\-]?\s*([A-Z\s'-]+)/i,
      /\bFAMILY\s+NAME\s*[:\-]?\s*([A-Z\s'-]+)/i
    ],
    givenNames: [
      /\bGIVEN\s+NAMES?\s*[:\-]?\s*([A-Z\s'-]+)/i,
      /\bFIRST\s+NAME\s*[:\-]?\s*([A-Z\s'-]+)/i
    ]
  };

  /**
   * Parses Schengen visa OCR text.
   * @param {string} rawText
   * @returns {object}
   */
  function parse(rawText) {
    const mrz = window.PVV.MRZParser ? window.PVV.MRZParser.parse(rawText) : null;
    const text = normalize(rawText);
    const warnings = [];
    const corrections = [];

    const surname = field(text, FIELD_PATTERNS.surname);
    const givenNames = field(text, FIELD_PATTERNS.givenNames);
    const validUntil = normalizeDate(field(text, FIELD_PATTERNS.validUntil));
    const validFrom = normalizeDate(field(text, FIELD_PATTERNS.validFrom));

    if (!validUntil) warnings.push("Schengen visa expiry date not detected.");
    if (!surname || !givenNames) warnings.push("Holder name not fully detected from visa text.");

    const expiry = expiryStatus(validUntil);

    return {
      documentType: "VISA",
      documentSubtype: "SCHENGEN",
      mrzFormat: mrz && mrz.mrzFormat !== "NONE" ? mrz.mrzFormat : "NONE",

      surname: surname || (mrz ? mrz.surname : ""),
      givenNames: givenNames || (mrz ? mrz.givenNames : ""),
      fullName: buildFullName(givenNames || (mrz ? mrz.givenNames : ""), surname || (mrz ? mrz.surname : "")),
      nationality: mrz ? mrz.nationality : "",
      nationalityCode: mrz ? mrz.nationalityCode : "",
      dateOfBirth: mrz ? mrz.dateOfBirth : "",
      gender: mrz ? mrz.gender : "UNSPECIFIED",

      documentNumber: field(text, FIELD_PATTERNS.passportNumber) || (mrz ? mrz.documentNumber : ""),
      issuingCountry: field(text, FIELD_PATTERNS.validFor) || "Schengen Area",
      issuingCountryCode: "SCHENGEN",
      issueDate: null,
      expiryDate: validUntil,

      visaType: field(text, FIELD_PATTERNS.visaType),
      validFor: field(text, FIELD_PATTERNS.validFor),
      validFrom,
      validUntil,
      entries: normalizeEntries(field(text, FIELD_PATTERNS.entries)),
      durationOfStay: field(text, FIELD_PATTERNS.duration),
      issuingPost: field(text, FIELD_PATTERNS.issuingPost),
      remarks: field(text, FIELD_PATTERNS.remarks),

      expiryStatus: expiry,

      checkDigits: mrz ? mrz.checkDigits : defaultCheckDigits(),

      confidence: confidence({
        hasMrz: mrz && mrz.mrzFormat !== "NONE",
        hasName: Boolean(surname && givenNames),
        hasExpiry: Boolean(validUntil),
        warnings
      }),

      corrections,
      warnings,

      mrzRaw: mrz ? mrz.mrzRaw : [],
      mrzCleaned: mrz ? mrz.mrzCleaned : [],
      rawOcrText: rawText || "",
      parsedAt: new Date().toISOString()
    };
  }

  function field(text, patterns) {
    for (const pattern of patterns) {
      const match = text.match(pattern);

      if (match) {
        return clean(match[2] || match[1]);
      }
    }

    return "";
  }

  function normalize(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/\r/g, "\n");
  }

  function clean(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/[^A-Z0-9\s'/-]/gi, "")
      .trim();
  }

  function normalizeEntries(value) {
    const cleanValue = clean(value);

    if (cleanValue === "MULTIPLE") return "MULT";
    return cleanValue;
  }

  function normalizeDate(value) {
    const text = String(value || "").trim();

    const match = text.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);

    if (!match) return "";

    let year = match[3];

    if (year.length === 2) {
      year = Number(year) > 40 ? `19${year}` : `20${year}`;
    }

    return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  }

  function expiryStatus(date) {
    if (window.PVV.MRZParser && window.PVV.MRZParser.expiryStatus) {
      return window.PVV.MRZParser.expiryStatus(date);
    }

    return {
      expired: false,
      status: date ? "VALID" : "UNKNOWN",
      daysUntilExpiry: null,
      daysExpired: null
    };
  }

  function defaultCheckDigits() {
    return {
      documentNumber: false,
      dateOfBirth: false,
      expiryDate: false,
      composite: false,
      allValid: false
    };
  }

  function confidence(input) {
    let score = 20;
    const breakdown = [];

    if (input.hasMrz) {
      score += 40;
      breakdown.push("+40 MRZ detected");
    }

    if (input.hasExpiry) {
      score += 15;
      breakdown.push("+15 expiry detected");
    }

    if (input.hasName) {
      score += 10;
      breakdown.push("+10 name detected");
    }

    score -= input.warnings.length * 5;

    score = Math.max(0, Math.min(100, score));

    return {
      score,
      grade: score >= 85 ? "HIGH" : score >= 60 ? "MEDIUM" : "LOW",
      breakdown
    };
  }

  function buildFullName(givenNames, surname) {
    return `${givenNames || ""} ${surname || ""}`.replace(/\s+/g, " ").trim();
  }

  window.PVV.Parsers.Schengen = {
    parse
  };
})(window);
