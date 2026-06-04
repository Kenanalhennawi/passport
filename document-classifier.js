(function (window) {
  "use strict";

  window.PVV = window.PVV || {};

  const DOCUMENT_RULES = [
    {
      type: "Refugee Protection Claimant Document",
      category: "Immigration / Protection Document",
      route: "refugee",
      keywords: [
        "REFUGEE PROTECTION CLAIMANT DOCUMENT",
        "REFUGEE PROTECTION CLAIMANT",
        "IMMIGRATION AND REFUGEE PROTECTION ACT",
        "APPLICATION NO",
        "UCI",
        "NOT VALID FOR TRAVEL"
      ]
    },
    {
      type: "Refugee Travel Document",
      category: "Primary Travel Document",
      route: "mrz",
      keywords: [
        "REFUGEE TRAVEL DOCUMENT",
        "CONVENTION TRAVEL DOCUMENT",
        "PROTECTED PERSON TRAVEL DOCUMENT"
      ]
    },
    {
      type: "Schengen Visa",
      category: "Visa",
      route: "schengen",
      keywords: [
        "SCHENGEN",
        "VALID FOR",
        "NUMBER OF ENTRIES",
        "DURATION OF STAY",
        "TYPE OF VISA",
        "ETATS SCHENGEN"
      ]
    },
    {
      type: "UAE Residence Visa",
      category: "Residence",
      route: "uaeVisa",
      keywords: [
        "UNITED ARAB EMIRATES",
        "RESIDENCE",
        "RESIDENCE VISA",
        "EMIRATES ID",
        "UID",
        "FILE NUMBER",
        "SPONSOR"
      ]
    },
    {
      type: "Emirates ID",
      category: "Identity Document",
      route: "uaeVisa",
      keywords: [
        "EMIRATES ID",
        "IDENTITY CARD",
        "ID NUMBER",
        "UNITED ARAB EMIRATES"
      ]
    },
    {
      type: "Entry Permit",
      category: "Immigration Authorization",
      route: "uaeVisa",
      keywords: [
        "ENTRY PERMIT",
        "PERMIT NO",
        "VALID UNTIL",
        "PORT OF ENTRY",
        "SPONSOR"
      ]
    },
    {
      type: "Work Permit",
      category: "Immigration Authorization",
      route: "generic",
      keywords: [
        "WORK PERMIT",
        "EMPLOYER",
        "OCCUPATION",
        "LABOUR",
        "LABOR"
      ]
    },
    {
      type: "Study Permit",
      category: "Immigration Authorization",
      route: "generic",
      keywords: [
        "STUDY PERMIT",
        "STUDENT",
        "INSTITUTION",
        "SCHOOL"
      ]
    },
    {
      type: "Permanent Resident Card",
      category: "Residence",
      route: "generic",
      keywords: [
        "PERMANENT RESIDENT",
        "PR CARD",
        "RESIDENT CARD",
        "GREEN CARD",
        "CARD EXPIRES"
      ]
    },
    {
      type: "US Visa",
      category: "Visa",
      route: "generic",
      keywords: [
        "UNITED STATES OF AMERICA",
        "VISA",
        "CONTROL NUMBER",
        "ANNOTATION",
        "VISA CLASS"
      ]
    },
    {
      type: "UK Visa",
      category: "Visa",
      route: "generic",
      keywords: [
        "UNITED KINGDOM",
        "ENTRY CLEARANCE",
        "LEAVE TO ENTER",
        "VALID UNTIL",
        "CONDITIONS"
      ]
    },
    {
      type: "Visa",
      category: "Visa",
      route: "generic",
      keywords: [
        "VISA",
        "VISA NO",
        "VISA NUMBER",
        "VALID FROM",
        "VALID UNTIL",
        "PASSPORT NO"
      ]
    },
    {
      type: "Passport",
      category: "Primary Travel Document",
      route: "mrz",
      keywords: [
        "PASSPORT",
        "NATIONALITY",
        "DATE OF BIRTH",
        "DATE OF EXPIRY",
        "ISSUING COUNTRY"
      ]
    }
  ];

  /**
   * Classifies a document from OCR text and optional MRZ result.
   * @param {string} rawText
   * @param {object|null} mrzResult
   * @returns {object}
   */
  function classifyDocument(rawText, mrzResult) {
    const text = normalize(rawText);
    const scores = DOCUMENT_RULES.map((rule) => scoreRule(rule, text));

    if (mrzResult && mrzResult.mrzFormat && mrzResult.mrzFormat !== "NONE") {
      scores.push({
        type: mrzResult.documentType || "Passport",
        category: "Primary Travel Document",
        route: "mrz",
        score: 95,
        matchedKeywords: ["MRZ"],
        rule: null
      });
    }

    scores.sort((a, b) => b.score - a.score);

    const best = scores[0] || {
      type: "Unknown Travel / Immigration Document",
      category: "Other",
      route: "generic",
      score: 0,
      matchedKeywords: []
    };

    return {
      type: best.score > 0 ? best.type : "Unknown Travel / Immigration Document",
      category: best.score > 0 ? best.category : "Other",
      route: best.route || "generic",
      confidence: Math.min(99, Math.round(best.score)),
      matchedKeywords: best.matchedKeywords || [],
      alternatives: scores.slice(1, 4).map((item) => ({
        type: item.type,
        confidence: Math.min(99, Math.round(item.score)),
        route: item.route
      }))
    };
  }

  function scoreRule(rule, text) {
    let score = 0;
    const matchedKeywords = [];

    for (const keyword of rule.keywords) {
      const normalizedKeyword = normalize(keyword);

      if (text.includes(normalizedKeyword)) {
        matchedKeywords.push(keyword);
        score += normalizedKeyword.length > 14 ? 18 : 10;
      }
    }

    if (matchedKeywords.length >= 3) score += 20;
    if (matchedKeywords.length >= 5) score += 25;

    return {
      type: rule.type,
      category: rule.category,
      route: rule.route,
      score,
      matchedKeywords,
      rule
    };
  }

  function normalize(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  window.PVV.DocumentClassifier = {
    classifyDocument,
    rules: DOCUMENT_RULES
  };
})(window);
