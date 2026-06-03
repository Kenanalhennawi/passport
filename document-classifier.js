// document-classifier.js

export function classifyDocument(rawText = "") {
  const text = normalize(rawText);
  const scores = [];

  addScore(scores, "Refugee Protection Claimant Document", text, [
    "REFUGEE PROTECTION CLAIMANT DOCUMENT",
    "REFUGEE PROTECTION CLAIMANT",
    "NOT VALID FOR TRAVEL",
    "IMMIGRATION AND REFUGEE PROTECTION ACT",
    "UCI",
    "APPLICATION NO"
  ]);

  addScore(scores, "Passport / Travel Document", text, [
    "PASSPORT",
    "TRAVEL DOCUMENT",
    "DATE OF EXPIRY",
    "ISSUING COUNTRY",
    "DOCUMENT NO"
  ]);

  addScore(scores, "Schengen Visa", text, [
    "SCHENGEN",
    "VALID FOR",
    "NUMBER OF ENTRIES",
    "DURATION OF STAY",
    "VISA"
  ]);

  addScore(scores, "UAE Residence Visa", text, [
    "UNITED ARAB EMIRATES",
    "RESIDENCE",
    "RESIDENCE VISA",
    "UID",
    "EMIRATES ID"
  ]);

  addScore(scores, "Emirates ID", text, [
    "EMIRATES ID",
    "IDENTITY CARD",
    "UNITED ARAB EMIRATES",
    "ID NUMBER"
  ]);

  addScore(scores, "Entry Permit", text, [
    "ENTRY PERMIT",
    "PERMIT NO",
    "VALID UNTIL",
    "SPONSOR"
  ]);

  addScore(scores, "Work Permit", text, [
    "WORK PERMIT",
    "EMPLOYER",
    "OCCUPATION",
    "LABOUR"
  ]);

  addScore(scores, "Study Permit", text, [
    "STUDY PERMIT",
    "STUDENT",
    "INSTITUTION",
    "SCHOOL"
  ]);

  addScore(scores, "Permanent Resident Card", text, [
    "PERMANENT RESIDENT",
    "PR CARD",
    "RESIDENT CARD",
    "CARD EXPIRES"
  ]);

  addScore(scores, "Visa", text, [
    "VISA",
    "VISA NO",
    "VISA NUMBER",
    "VALID FROM",
    "VALID UNTIL",
    "PASSPORT NO"
  ]);

  scores.sort((a, b) => b.score - a.score);

  const best = scores[0] || {
    type: "Unknown Travel / Immigration Document",
    score: 0,
    matchedKeywords: []
  };

  return {
    type: best.score > 0 ? best.type : "Unknown Travel / Immigration Document",
    confidence: Math.min(99, Math.round(best.score)),
    matchedKeywords: best.matchedKeywords,
    alternatives: scores.slice(1, 4)
  };
}

function addScore(scores, type, text, keywords) {
  let score = 0;
  const matchedKeywords = [];

  for (const keyword of keywords) {
    if (text.includes(keyword)) {
      matchedKeywords.push(keyword);
      score += keyword.length > 12 ? 18 : 10;
    }
  }

  if (matchedKeywords.length >= 3) score += 20;
  if (matchedKeywords.length >= 5) score += 25;

  scores.push({
    type,
    score,
    matchedKeywords
  });
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}
