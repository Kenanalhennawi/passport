(function (window) {
  "use strict";

  window.PVV = window.PVV || {};

  const FILLER_CHARS = new Set(["K", "L", "I", "S", "Z", "X"]);

  const NAME_PARTICLES = new Set([
    "AL", "EL", "DE", "DA", "DI", "DO", "DOS", "DAS", "DEL", "DELA", "DELOS",
    "VAN", "VON", "DER", "DEN", "DEM",
    "BIN", "IBN", "ABU", "ABD", "ABDUL", "ABDEL",
    "O", "MC", "MAC", "ST",
    "LA", "LE", "LES", "LOS", "LAS"
  ]);

  function parseMrzNameGlobal(nameZone, options = {}) {
    const warnings = [];
    const reasons = [];
    const removedNoiseTokens = [];

    const visibleSurnameTokens = tokenizeVisible(options.visibleSurname || "");
    const visibleGivenTokens = tokenizeVisible(options.visibleGiven || "");

    let zone = sanitize(nameZone);

    if (!zone.includes("<<")) {
      zone = repairMissingPrimarySeparator(zone, warnings);
    }

    const sepIndex = zone.indexOf("<<");

    let surnamePart = "";
    let givenPart = "";

    if (sepIndex >= 0) {
      surnamePart = zone.slice(0, sepIndex);
      givenPart = zone.slice(sepIndex + 2);
    } else {
      surnamePart = zone;
      warnings.push('Primary MRZ name separator "<<" was not found.');
    }

    const surnameTokens = cleanNameTokens(
      surnamePart.split("<").filter(Boolean),
      visibleSurnameTokens,
      removedNoiseTokens,
      warnings,
      reasons,
      true
    );

    const givenNameTokens = cleanNameTokens(
      givenPart.split("<").filter(Boolean),
      visibleGivenTokens,
      removedNoiseTokens,
      warnings,
      reasons,
      false
    );

    const surname = surnameTokens.join(" ");
    const givenNames = givenNameTokens.join(" ");
    const fullName = `${givenNames} ${surname}`.replace(/\s+/g, " ").trim();

    let score = 100;

    if (!surname) {
      score -= 25;
      warnings.push("Surname could not be confidently parsed.");
    }

    if (!givenNames && givenPart) {
      score -= 15;
      warnings.push("Given names were removed or not detected.");
    }

    if (removedNoiseTokens.length) {
      const penalty = Math.min(35, removedNoiseTokens.length * 8);
      score -= penalty;
      reasons.push(`Removed ${removedNoiseTokens.length} OCR filler/noise token(s).`);
    }

    if (warnings.length) {
      score -= Math.min(20, warnings.length * 4);
    }

    score = Math.max(0, Math.min(100, score));

    return {
      surname,
      givenNames,
      fullName,
      surnameTokens,
      givenNameTokens,
      removedNoiseTokens,
      confidence: {
        score,
        grade: score >= 85 ? "HIGH" : score >= 60 ? "MEDIUM" : "LOW",
        reasons: reasons.length ? reasons : ["MRZ name parsed successfully."]
      },
      warnings
    };
  }

  function cleanNameTokens(tokens, visibleTokens, removedNoiseTokens, warnings, reasons, isSurname) {
    const output = [];
    let acceptedRealToken = false;
    let noiseStarted = false;

    for (const rawToken of tokens) {
      const token = sanitizeNameToken(rawToken);

      if (!token) continue;

      const visibleConfirmed = visibleTokens.has(token);

      if (noiseStarted) {
        if (visibleConfirmed || NAME_PARTICLES.has(token)) {
          output.push(token);
          warnings.push(`Suspicious token "${token}" kept because it was confirmed by visible text or particle list.`);
          acceptedRealToken = true;
        } else {
          removedNoiseTokens.push(token);
        }
        continue;
      }

      const noise = isNoiseToken(token, acceptedRealToken, isSurname);

      if (noise && !visibleConfirmed && !NAME_PARTICLES.has(token)) {
        removedNoiseTokens.push(token);
        reasons.push(`Token "${token}" removed as OCR filler noise.`);

        if (!isSurname || acceptedRealToken) {
          noiseStarted = true;
        }

        continue;
      }

      output.push(token);

      if (!NAME_PARTICLES.has(token)) {
        acceptedRealToken = true;
      }
    }

    return output;
  }

  function isNoiseToken(token, acceptedRealToken, isSurname) {
    if (!token) return true;
    if (NAME_PARTICLES.has(token)) return false;

    if (/^[KLISZX]+$/.test(token)) {
      if (!isSurname || acceptedRealToken) return true;
      if (token.length >= 4) return true;
    }

    if (isAlternatingFiller(token)) return true;

    const ratio = fillerRatio(token);

    if (acceptedRealToken && ratio >= 0.8) return true;

    if (acceptedRealToken && token.length <= 3 && !hasVowel(token)) return true;

    if (token.length >= 4 && ratio >= 0.85) return true;

    return false;
  }

  function repairMissingPrimarySeparator(zone, warnings) {
    const repaired = zone.replace(/([A-Z])([KLISZX]{2,4})([A-Z])/g, function (match, before, middle, after) {
      if (NAME_PARTICLES.has(middle)) return match;
      warnings.push(`Possible corrupted MRZ separator "${middle}" replaced with "<<".`);
      return `${before}<<${after}`;
    });

    return repaired;
  }

  function sanitize(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/[^A-Z<]/g, "")
      .replace(/<{3,}/g, "<<");
  }

  function sanitizeNameToken(value) {
    return String(value || "")
      .toUpperCase()
      .replace(/[^A-Z'-]/g, "")
      .trim();
  }

  function tokenizeVisible(value) {
    return new Set(
      String(value || "")
        .toUpperCase()
        .replace(/[^A-Z\s'-]/g, " ")
        .split(/\s+/)
        .map((x) => x.trim())
        .filter(Boolean)
    );
  }

  function hasVowel(value) {
    return /[AEIOU]/.test(value);
  }

  function fillerRatio(token) {
    if (!token) return 0;

    let count = 0;

    for (const char of token) {
      if (FILLER_CHARS.has(char)) count += 1;
    }

    return count / token.length;
  }

  function isAlternatingFiller(token) {
    if (token.length < 4) return false;
    if (!/^[KLISZX]+$/.test(token)) return false;

    const unique = new Set(token.split(""));

    if (unique.size <= 2 && fillerRatio(token) === 1) return true;

    return /^(KL|LK|KI|IK|LI|IL|KZ|ZK|LS|SL)+$/.test(token);
  }

  window.PVV.NameParser = {
    parseMrzNameGlobal
  };
})(window);
