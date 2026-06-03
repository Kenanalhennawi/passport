export function compareDocuments(primaryDocument, secondaryDocument) {
  const fields = [
    compareNameField(primaryDocument, secondaryDocument),
    compareDateOfBirth(primaryDocument, secondaryDocument),
    compareGender(primaryDocument, secondaryDocument),
    comparePassportNumber(primaryDocument, secondaryDocument),
    compareNationalityAndCitizenship(primaryDocument, secondaryDocument),
    compareIssuingCountry(primaryDocument, secondaryDocument),
    validateExpiryField("Primary Document Expiry", primaryDocument.expiryDate, "primary"),
    validateExpiryField("Secondary Document Expiry", secondaryDocument.expiryDate, "secondary")
  ];

  const alerts = buildAlerts(fields, primaryDocument, secondaryDocument);
  const score = calculateWeightedScore(fields);
  const decision = decide(fields, score);
  const riskLevel = getRiskLevel(decision, score);
  const reason = buildReason(fields, decision);

  return {
    decision,
    riskLevel,
    score,
    reason,
    fields,
    alerts
  };
}

function compareNameField(primary, secondary) {
  const primaryName = primary.fullName || `${primary.givenNames || ""} ${primary.surname || ""}`.trim();
  const secondaryName = secondary.fullName || `${secondary.givenNames || ""} ${secondary.surname || ""}`.trim();

  return compareField("Full Name", primaryName, secondaryName, "name", 25);
}

function compareDateOfBirth(primary, secondary) {
  return compareField("Date of Birth", primary.dateOfBirth, secondary.dateOfBirth, "strict", 25);
}

function compareGender(primary, secondary) {
  return compareField("Gender", primary.gender, secondary.gender, "gender", 10);
}

function comparePassportNumber(primary, secondary) {
  const primaryPassportNumber = primary.passportNumber || primary.documentNumber || "";
  const secondaryPassportNumber = secondary.passportNumber || "";

  if (!secondaryPassportNumber) {
    return {
      label: "Passport Number",
      passportValue: primaryPassportNumber,
      visaValue: "Not detected / not available",
      status: "Not Available",
      statusClass: "partial",
      score: 75,
      weight: 15,
      critical: false,
      note: "Secondary document does not show a passport number. This is acceptable for some document types."
    };
  }

  return compareField("Passport Number", primaryPassportNumber, secondaryPassportNumber, "strict", 15, true);
}

function compareNationalityAndCitizenship(primary, secondary) {
  const primaryNationality = primary.nationality || "";
  const secondaryNationality = secondary.nationality || "";
  const secondaryCitizenship = secondary.citizenship || "";

  if (!primaryNationality && !secondaryNationality && !secondaryCitizenship) {
    return {
      label: "Nationality / Citizenship",
      passportValue: "Not detected",
      visaValue: "Not detected",
      status: "Missing",
      statusClass: "partial",
      score: 65,
      weight: 10,
      critical: false,
      note: "Nationality or citizenship could not be detected."
    };
  }

  if (secondaryNationality) {
    return compareField(
      "Nationality",
      primaryNationality,
      secondaryNationality,
      "country",
      10,
      false
    );
  }

  if (secondaryCitizenship) {
    return {
      label: "Nationality / Citizenship",
      passportValue: primaryNationality || "Not detected",
      visaValue: secondaryCitizenship,
      status: "Information Only",
      statusClass: "partial",
      score: 85,
      weight: 10,
      critical: false,
      note: "Secondary document shows citizenship. Citizenship may differ from issuing country or travel document nationality."
    };
  }

  return {
    label: "Nationality / Citizenship",
    passportValue: primaryNationality || "Not detected",
    visaValue: "Not detected",
    status: "Missing",
    statusClass: "partial",
    score: 65,
    weight: 10,
    critical: false,
    note: "Secondary document nationality/citizenship was not detected."
  };
}

function compareIssuingCountry(primary, secondary) {
  const primaryIssuing = primary.issuingCountry || "";
  const secondaryIssuing = secondary.issuingCountry || "";

  if (!primaryIssuing && !secondaryIssuing) {
    return {
      label: "Issuing Country",
      passportValue: "Not detected",
      visaValue: "Not detected",
      status: "Missing",
      statusClass: "partial",
      score: 70,
      weight: 5,
      critical: false,
      note: "Issuing country was not detected on one or both documents."
    };
  }

  if (!secondaryIssuing) {
    return {
      label: "Issuing Country",
      passportValue: primaryIssuing || "Not detected",
      visaValue: "Not detected",
      status: "Not Available",
      statusClass: "partial",
      score: 75,
      weight: 5,
      critical: false,
      note: "Secondary document issuing country was not detected."
    };
  }

  if (normalizeCountry(primaryIssuing) === normalizeCountry(secondaryIssuing)) {
    return {
      label: "Issuing Country",
      passportValue: primaryIssuing,
      visaValue: secondaryIssuing,
      status: "Exact Match",
      statusClass: "match",
      score: 100,
      weight: 5,
      critical: false,
      note: "Both documents appear to be issued by the same country."
    };
  }

  return {
    label: "Issuing Country",
    passportValue: primaryIssuing || "Not detected",
    visaValue: secondaryIssuing,
    status: "Information Only",
    statusClass: "partial",
    score: 85,
    weight: 5,
    critical: false,
    note: "Different issuing countries can be normal for visas, residence permits, refugee documents, and travel documents."
  };
}

function compareField(label, primaryValue, secondaryValue, mode, weight = 10, critical = false) {
  const p = normalize(primaryValue);
  const s = normalize(secondaryValue);

  if (!p || !s) {
    return {
      label,
      passportValue: primaryValue || "Not detected",
      visaValue: secondaryValue || "Not detected",
      status: "Missing",
      statusClass: "partial",
      score: critical ? 40 : 65,
      weight,
      critical,
      note: "One or both values were not detected."
    };
  }

  if (mode === "name") {
    return compareNames(label, primaryValue, secondaryValue, weight, critical);
  }

  if (mode === "gender") {
    const pg = normalizeGender(primaryValue);
    const sg = normalizeGender(secondaryValue);

    if (pg && sg && pg === sg) {
      return makeMatch(label, primaryValue, secondaryValue, weight, critical);
    }

    if (!pg || !sg) {
      return {
        label,
        passportValue: primaryValue || "Not detected",
        visaValue: secondaryValue || "Not detected",
        status: "Missing",
        statusClass: "partial",
        score: 65,
        weight,
        critical: false,
        note: "Gender could not be confidently normalized."
      };
    }

    return makeMismatch(label, primaryValue, secondaryValue, "Gender values are different.", weight, critical);
  }

  if (mode === "country") {
    if (normalizeCountry(primaryValue) === normalizeCountry(secondaryValue)) {
      return makeMatch(label, primaryValue, secondaryValue, weight, critical);
    }

    return {
      label,
      passportValue: primaryValue || "Not detected",
      visaValue: secondaryValue || "Not detected",
      status: "Information Only",
      statusClass: "partial",
      score: 80,
      weight,
      critical: false,
      note: "Country value differs. This may be normal depending on document type."
    };
  }

  if (p === s) {
    return makeMatch(label, primaryValue, secondaryValue, weight, critical);
  }

  const correctedP = correctOcrConfusions(p);
  const correctedS = correctOcrConfusions(s);

  if (correctedP === correctedS) {
    return {
      label,
      passportValue: primaryValue,
      visaValue: secondaryValue,
      status: "Partial Match",
      statusClass: "partial",
      score: 90,
      weight,
      critical,
      note: "Values match after OCR confusion correction."
    };
  }

  return makeMismatch(label, primaryValue, secondaryValue, "Values are different.", weight, critical);
}

function compareNames(label, primaryValue, secondaryValue, weight, critical) {
  const p = normalizeName(primaryValue);
  const s = normalizeName(secondaryValue);

  if (!p || !s) {
    return {
      label,
      passportValue: primaryValue || "Not detected",
      visaValue: secondaryValue || "Not detected",
      status: "Missing",
      statusClass: "partial",
      score: 55,
      weight,
      critical,
      note: "Name could not be detected on one or both documents."
    };
  }

  if (p === s) {
    return makeMatch(label, primaryValue, secondaryValue, weight, critical);
  }

  const pTokens = tokenizeName(p);
  const sTokens = tokenizeName(s);

  const sortedP = [...pTokens].sort().join(" ");
  const sortedS = [...sTokens].sort().join(" ");

  if (sortedP && sortedP === sortedS) {
    return {
      label,
      passportValue: primaryValue,
      visaValue: secondaryValue,
      status: "Partial Match",
      statusClass: "partial",
      score: 92,
      weight,
      critical,
      note: "Same name tokens detected, but order is different."
    };
  }

  const overlap = tokenOverlapScore(pTokens, sTokens);
  const similarity = stringSimilarity(p, s);
  const combined = Math.max(overlap, similarity);

  if (combined >= 0.82) {
    return {
      label,
      passportValue: primaryValue,
      visaValue: secondaryValue,
      status: "Partial Match",
      statusClass: "partial",
      score: Math.round(combined * 100),
      weight,
      critical,
      note: "Names are highly similar but not identical."
    };
  }

  return makeMismatch(label, primaryValue, secondaryValue, "Names do not match.", weight, critical);
}

function validateExpiryField(label, value, source) {
  const output = {
    label,
    passportValue: source === "primary" ? value || "Not detected" : "",
    visaValue: source === "secondary" ? value || "Not detected" : "",
    weight: 5,
    critical: false
  };

  if (!value) {
    return {
      ...output,
      status: "Missing",
      statusClass: "partial",
      score: 70,
      note: "Expiry date was not detected."
    };
  }

  const date = new Date(value);
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  if (Number.isNaN(date.getTime())) {
    return {
      ...output,
      status: "Invalid Date",
      statusClass: "partial",
      score: 60,
      note: "Date format could not be validated."
    };
  }

  if (date < now) {
    return {
      ...output,
      status: "Expired",
      statusClass: "mismatch",
      score: 0,
      critical: true,
      note: `${label} is expired.`
    };
  }

  return {
    ...output,
    status: "Valid",
    statusClass: "match",
    score: 100,
    note: `${label} is valid.`
  };
}

function makeMatch(label, primaryValue, secondaryValue, weight, critical) {
  return {
    label,
    passportValue: primaryValue || "Not detected",
    visaValue: secondaryValue || "Not detected",
    status: "Exact Match",
    statusClass: "match",
    score: 100,
    weight,
    critical,
    note: "Values are identical."
  };
}

function makeMismatch(label, primaryValue, secondaryValue, note, weight, critical) {
  return {
    label,
    passportValue: primaryValue || "Not detected",
    visaValue: secondaryValue || "Not detected",
    status: "Mismatch",
    statusClass: "mismatch",
    score: 0,
    weight,
    critical,
    note
  };
}

function buildAlerts(fields, primary, secondary) {
  const alerts = [];

  for (const field of fields) {
    if (field.status === "Mismatch") {
      alerts.push(`❌ ${field.label}: ${field.note}`);
    }

    if (field.status === "Expired") {
      alerts.push(`❌ ${field.label}: document is expired.`);
    }

    if (
      field.status === "Partial Match" ||
      field.status === "Missing" ||
      field.status === "Not Available" ||
      field.status === "Invalid Date"
    ) {
      alerts.push(`⚠ ${field.label}: ${field.note}`);
    }

    if (field.status === "Information Only") {
      alerts.push(`ℹ ${field.label}: ${field.note}`);
    }
  }

  if (!primary.mrzRawData) {
    alerts.push("⚠ Primary document MRZ was not detected clearly.");
  }

  if (secondary.documentType) {
    alerts.push(`ℹ Secondary document detected as: ${secondary.documentType}.`);
  }

  return alerts;
}

function calculateWeightedScore(fields) {
  const totalWeight = fields.reduce((sum, field) => sum + (field.weight || 1), 0);
  const weightedScore = fields.reduce((sum, field) => {
    return sum + ((field.score || 0) * (field.weight || 1));
  }, 0);

  return Math.round(weightedScore / totalWeight);
}

function decide(fields, score) {
  const expiredCritical = fields.some((field) => field.status === "Expired" && field.critical);

  const criticalMismatch = fields.some((field) => {
    return field.critical === true && field.status === "Mismatch";
  });

  const nameMismatch = fields.some((field) => {
    return field.label === "Full Name" && field.status === "Mismatch";
  });

  const dobMismatch = fields.some((field) => {
    return field.label === "Date of Birth" && field.status === "Mismatch";
  });

  if (expiredCritical || criticalMismatch || (nameMismatch && dobMismatch)) {
    return "REJECTED";
  }

  if (score >= 92) {
    return "VERIFIED";
  }

  if (score >= 78) {
    return "VERIFIED WITH WARNINGS";
  }

  return "MANUAL REVIEW REQUIRED";
}

function getRiskLevel(decision, score) {
  if (decision === "VERIFIED") return "LOW";
  if (decision === "VERIFIED WITH WARNINGS") return "MEDIUM";
  if (decision === "REJECTED") return "HIGH";
  if (score >= 70) return "MEDIUM";
  return "HIGH";
}

function buildReason(fields, decision) {
  const criticalProblems = fields.filter((field) => {
    return field.critical && (field.status === "Mismatch" || field.status === "Expired");
  });

  const warnings = fields.filter((field) => {
    return ["Partial Match", "Missing", "Not Available", "Invalid Date"].includes(field.status);
  });

  if (decision === "VERIFIED") {
    return "All critical identity fields are valid and matched.";
  }

  if (decision === "VERIFIED WITH WARNINGS") {
    return `Identity appears acceptable, but ${warnings.length} field(s) require attention.`;
  }

  if (decision === "REJECTED") {
    return `Critical issue detected: ${criticalProblems.map((field) => field.label).join(", ") || "identity mismatch"}.`;
  }

  return "Document data could not be verified confidently and requires manual review.";
}

function normalize(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .trim();
}

function normalizeName(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ")
    .replace(/\bGIVEN\b/g, " ")
    .replace(/\bNAME\b/g, " ")
    .replace(/\bNAMES\b/g, " ")
    .replace(/\bSURNAME\b/g, " ")
    .replace(/\bFAMILY\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeName(value) {
  return normalizeName(value)
    .split(" ")
    .filter((token) => token.length > 1)
    .filter((token) => !["MR", "MS", "MRS", "MISS"].includes(token));
}

function normalizeGender(value) {
  const v = String(value || "").toUpperCase().trim();

  if (["M", "MALE"].includes(v)) return "M";
  if (["F", "FEMALE"].includes(v)) return "F";

  return "";
}

function normalizeCountry(value) {
  const v = String(value || "").toUpperCase().replace(/[^A-Z]/g, "");

  const map = {
    CANADA: "CAN",
    CAN: "CAN",
    SYRIA: "SYR",
    SYRIANARABREPUBLIC: "SYR",
    SYR: "SYR",
    UNITEDARABEMIRATES: "ARE",
    UAE: "ARE",
    ARE: "ARE",
    SAUDIARABIA: "SAU",
    KSA: "SAU",
    SAU: "SAU",
    UNITEDSTATES: "USA",
    USA: "USA",
    UNITEDKINGDOM: "GBR",
    UK: "GBR",
    GBR: "GBR"
  };

  return map[v] || v;
}

function correctOcrConfusions(value) {
  return String(value || "")
    .replace(/O/g, "0")
    .replace(/I/g, "1")
    .replace(/B/g, "8")
    .replace(/S/g, "5")
    .replace(/Z/g, "2");
}

function tokenOverlapScore(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;

  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  let matches = 0;

  for (const token of aSet) {
    if (bSet.has(token)) {
      matches += 1;
      continue;
    }

    for (const other of bSet) {
      if (stringSimilarity(token, other) >= 0.84) {
        matches += 1;
        break;
      }
    }
  }

  return matches / Math.max(aSet.size, bSet.size);
}

function stringSimilarity(a, b) {
  const first = String(a || "");
  const second = String(b || "");

  const longer = first.length > second.length ? first : second;
  const shorter = first.length > second.length ? second : first;

  if (!longer.length) return 1;

  const distance = levenshtein(longer, shorter);
  return (longer.length - distance) / longer.length;
}

function levenshtein(a, b) {
  const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i]);

  for (let j = 0; j <= a.length; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i += 1) {
    for (let j = 1; j <= a.length; j += 1) {
      matrix[i][j] = b.charAt(i - 1) === a.charAt(j - 1)
        ? matrix[i - 1][j - 1]
        : Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
    }
  }

  return matrix[b.length][a.length];
}