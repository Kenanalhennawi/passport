(function (window) {
  "use strict";

  window.PVV = window.PVV || {};
  window.PVV.Parsers = window.PVV.Parsers || {};

  const PATTERNS = {
    visaNumber: [
      /\bVISA\s*(NO|NUMBER)?\s*[:\-]?\s*([0-9]{2,4}\/[0-9]{4}\/[0-9]{4,12})/i,
      /\bPERMIT\s*(NO|NUMBER)?\s*[:\-]?\s*([A-Z0-9/-]{6,25})/i
    ],
    uid: [
      /\bUID\s*(NO|NUMBER)?\s*[:\-]?\s*([0-9]{6,20})/i
    ],
    fileNumber: [
      /\bFILE\s*(NO|NUMBER)?\s*[:\-]?\s*([0-9/.-]{6,25})/i,
      /\bUNIFIED\s*(NO|NUMBER)?\s*[:\-]?\s*([0-9]{6,20})/i
    ],
    emiratesId: [
      /\bEMIRATES\s*ID\s*[:\-]?\s*([0-9\-]{10,25})/i,
      /\bID\s*NUMBER\s*[:\-]?\s*([0-9\-]{10,25})/i
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
      /\bNAME\s*[:\-]?\s*([A-Z\s'-]+)/i
    ],
    nationality: [
      /\bNATIONALITY\s*[:\-]?\s*([A-Z\s]+)/i
    ],
    dob: [
      /\bDATE\s+OF\s+BIRTH\s*[:\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})/i,
      /\bDOB\s*[:\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})/i
    ],
    gender: [
      /\bSEX\s*[:\-]?\s*(M|F|MALE|FEMALE)/i,
      /\bGENDER\s*[:\-]?\s*(M|F|MALE|FEMALE)/i
    ],
    issueDate: [
      /\bISSUE\s+DATE\s*[:\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})/i
    ],
    expiryDate: [
      /\bEXPIRY\s+DATE\s*[:\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})/i,
      /\bVALID\s+UNTIL\s*[:\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})/i
    ],
    sponsor: [
      /\bSPONSOR\s*(NAME)?\s*[:\-]?\s*([A-Z0-9\s'-]+)/i
    ],
    sponsorNumber: [
      /\bSPONSOR\s*(NO|NUMBER)?\s*[:\-]?\s*([A-Z0-9/-]{5,25})/i
    ],
    profession: [
      /\bPROFESSION\s*[:\-]?\s*([A-Z\s'-]+)/i,
      /\bOCCUPATION\s*[:\-]?\s*([A-Z\s'-]+)/i
    ],
    entryType: [
      /\bENTRY\s*TYPE\s*[:\-]?\s*(SINGLE|MULTIPLE|TRANSIT)/i,
      /\bTYPE\s*[:\-]?\s*(SINGLE|MULTIPLE|TRANSIT)/i
    ],
    portOfEntry: [
      /\bPORT\s+OF\s+ENTRY\s*[:\-]?\s*([A-Z\s]+)/i,
      /\bENTRY\s+PORT\s*[:\-]?\s*([A-Z\s]+)/i
    ]
  };

  /**
   * Parses UAE visa, residence visa, entry permit, or Emirates ID OCR text.
   * @param {string} rawText
   * @returns {object}
   */
  function parse(rawText) {
    const text = normalize(rawText);
    const warnings = [];
    const corrections = [];

    const documentSubtype = detectSubtype(text);
    const surname = field(text, PATTERNS.surname);
    const givenNames = field(text, PATTERNS.givenNames);
    const expiryDate = normalizeDate(field(text, PATTERNS.expiryDate));

    if (!expiryDate) warnings.push("Expiry date not detected.");
    if (!surname && !givenNames) warnings.push("Name not fully detected.");
    if (!field(text, PATTERNS.passportNumber)) warnings.push("Passport number not detected.");

    const nationalityCode = normalizeNationalityCode(field(text, PATTERNS.nationality));
    const expiry = expiryStatus(expiryDate);

    return {
      documentType: documentSubtype === "EMIRATES_ID" ? "IDENTITY_CARD" : "RESIDENCE",
      documentSubtype,
      mrzFormat: "NONE",

      surname,
      givenNames,
      fullName: buildFullName(givenNames, surname),
      nationality: countryName(nationalityCode),
      nationalityCode,
      dateOfBirth: normalizeDate(field(text, PATTERNS.dob)),
      gender: normalizeGender(field(text, PATTERNS.gender)),

      documentNumber: field(text, PATTERNS.visaNumber) ||
        field(text, PATTERNS.emiratesId) ||
        field(text, PATTERNS.uid),

      issuingCountry: "United Arab Emirates",
      issuingCountryCode: "ARE",
      issueDate: normalizeDate(field(text, PATTERNS.issueDate)),
      expiryDate,

      uid: field(text, PATTERNS.uid),
      fileNumber: field(text, PATTERNS.fileNumber),
      emiratesId: field(text, PATTERNS.emiratesId),
      passportNumber: field(text, PATTERNS.passportNumber),
      visaNumber: field(text, PATTERNS.visaNumber),
      entryType: field(text, PATTERNS.entryType),
      profession: field(text, PATTERNS.profession),
      sponsorName: field(text, PATTERNS.sponsor),
      sponsorNumber: field(text, PATTERNS.sponsorNumber),
      portOfEntry: field(text, PATTERNS.portOfEntry),

      expiryStatus: expiry,

      checkDigits: {
        documentNumber: false,
        dateOfBirth: false,
        expiryDate: false,
        composite: false,
        allValid: false
      },

      confidence: confidence({
        hasName: Boolean(surname || givenNames),
        hasDocumentNumber: Boolean(field(text, PATTERNS.visaNumber) || field(text, PATTERNS.emiratesId) || field(text, PATTERNS.uid)),
        hasExpiry: Boolean(expiryDate),
        hasPassport: Boolean(field(text, PATTERNS.passportNumber)),
        warnings
      }),

      corrections,
      warnings,

      mrzRaw: [],
      mrzCleaned: [],
      rawOcrText: rawText || "",
      parsedAt: new Date().toISOString()
    };
  }

  function detectSubtype(text) {
    if (text.includes("EMIRATES ID") || text.includes("IDENTITY CARD")) return "EMIRATES_ID";
    if (text.includes("ENTRY PERMIT")) return "ENTRY_PERMIT";
    if (text.includes("RESIDENCE VISA") || text.includes("RESIDENCE")) return "UAE_RESIDENCE_VISA";
    if (text.includes("TRANSIT")) return "TRANSIT_VISA";
    return "UAE_VISA_OR_RESIDENCE";
  }

  function field(text, patterns) {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return clean(match[2] || match[1]);
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
      .replace(/[^A-Z0-9\s'\/\-.:-]/gi, "")
      .trim();
  }

  function normalizeDate(value) {
    const cleanValue = String(value || "").trim();

    if (!cleanValue) return "";

    const iso = cleanValue.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
    if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;

    const dmy = cleanValue.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (dmy) {
      let year = dmy[3];
      if (year.length === 2) year = Number(year) > 40 ? `19${year}` : `20${year}`;
      return `${year}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
    }

    return "";
  }

  function normalizeGender(value) {
    const cleanValue = String(value || "").toUpperCase().trim();
    if (["M", "MALE"].includes(cleanValue)) return "MALE";
    if (["F", "FEMALE"].includes(cleanValue)) return "FEMALE";
    return "UNSPECIFIED";
  }

  function normalizeNationalityCode(value) {
    const cleanValue = String(value || "").toUpperCase();

    const map = {
      SYRIA: "SYR",
      SYRIAN: "SYR",
      INDIA: "IND",
      INDIAN: "IND",
      PAKISTAN: "PAK",
      PAKISTANI: "PAK",
      CANADA: "CAN",
      CANADIAN: "CAN",
      UAE: "ARE",
      "UNITED ARAB EMIRATES": "ARE"
    };

    if (/^[A-Z]{3}$/.test(cleanValue)) return cleanValue;

    for (const key of Object.keys(map)) {
      if (cleanValue.includes(key)) return map[key];
    }

    return "";
  }

  function countryName(code) {
    if (window.PVV.Countries && window.PVV.Countries.getCountryName) {
      return window.PVV.Countries.getCountryName(code);
    }

    return code || "";
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

  function confidence(input) {
    let score = 25;
    const breakdown = [];

    if (input.hasName) {
      score += 10;
      breakdown.push("+10 name detected");
    }

    if (input.hasDocumentNumber) {
      score += 20;
      breakdown.push("+20 document number detected");
    }

    if (input.hasExpiry) {
      score += 15;
      breakdown.push("+15 expiry detected");
    }

    if (input.hasPassport) {
      score += 15;
      breakdown.push("+15 passport number detected");
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

  window.PVV.Parsers.UAEVisa = {
    parse
  };
})(window);
