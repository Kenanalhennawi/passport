(function (window) {
  "use strict";

  window.PVV = window.PVV || {};

  const WEIGHTS = [7, 3, 1];

  const FIELD_CORRECTIONS = {
    digit: {
      O: "0",
      I: "1",
      L: "1",
      B: "8",
      S: "5",
      Z: "2",
      G: "6",
      Q: "0",
      D: "0"
    },
    alpha: {
      "0": "O",
      "1": "I",
      "8": "B",
      "5": "S",
      "2": "Z",
      "6": "G"
    }
  };

  /**
   * Returns the ICAO 9303 numeric value for a character.
   * @param {string} char
   * @returns {number}
   */
  function charValue(char) {
    const c = String(char || "").toUpperCase();

    if (c === "<") return 0;
    if (/^[0-9]$/.test(c)) return Number(c);
    if (/^[A-Z]$/.test(c)) return c.charCodeAt(0) - 55;

    return 0;
  }

  /**
   * Computes ICAO 9303 check digit.
   * @param {string} input
   * @returns {number}
   */
  function compute(input) {
    return String(input || "")
      .toUpperCase()
      .split("")
      .reduce((sum, char, index) => sum + charValue(char) * WEIGHTS[index % 3], 0) % 10;
  }

  /**
   * Validates a field against a supplied check digit.
   * @param {string} field
   * @param {string|number} digit
   * @returns {boolean}
   */
  function validate(field, digit) {
    if (digit === undefined || digit === null || digit === "<") return false;
    return String(compute(field)) === String(digit);
  }

  /**
   * Corrects OCR digit confusions inside numeric-only fields.
   * @param {string} value
   * @returns {{corrected:string, corrections:Array}}
   */
  function correctDigitField(value) {
    const original = String(value || "").toUpperCase();
    let corrected = "";
    const corrections = [];

    for (let i = 0; i < original.length; i += 1) {
      const char = original[i];
      const replacement = FIELD_CORRECTIONS.digit[char] || char;

      corrected += replacement;

      if (replacement !== char) {
        corrections.push({
          index: i,
          original: char,
          corrected: replacement
        });
      }
    }

    return { corrected, corrections };
  }

  /**
   * Corrects OCR alpha confusions inside name/country fields.
   * @param {string} value
   * @returns {{corrected:string, corrections:Array}}
   */
  function correctAlphaField(value) {
    const original = String(value || "").toUpperCase();
    let corrected = "";
    const corrections = [];

    for (let i = 0; i < original.length; i += 1) {
      const char = original[i];
      const replacement = FIELD_CORRECTIONS.alpha[char] || char;

      corrected += replacement;

      if (replacement !== char) {
        corrections.push({
          index: i,
          original: char,
          corrected: replacement
        });
      }
    }

    return { corrected, corrections };
  }

  /**
   * Attempts character substitutions until a check digit validates.
   * @param {string} field
   * @param {string} digit
   * @param {"document"|"date"|"alpha"} fieldType
   * @returns {{value:string, valid:boolean, corrections:Array}}
   */
  function correctWithCheckDigit(field, digit, fieldType) {
    const original = String(field || "").toUpperCase();

    if (validate(original, digit)) {
      return {
        value: original,
        valid: true,
        corrections: []
      };
    }

    if (fieldType === "date") {
      const result = correctDigitField(original);

      return {
        value: result.corrected,
        valid: validate(result.corrected, digit),
        corrections: result.corrections
      };
    }

    if (fieldType === "alpha") {
      const result = correctAlphaField(original);

      return {
        value: result.corrected,
        valid: validate(result.corrected, digit),
        corrections: result.corrections
      };
    }

    const variants = generateDocumentVariants(original, 30);

    for (const variant of variants) {
      if (validate(variant.value, digit)) {
        return variant;
      }
    }

    return {
      value: original,
      valid: false,
      corrections: []
    };
  }

  /**
   * Generates likely document number correction variants.
   * @param {string} value
   * @param {number} maxVariants
   * @returns {Array<{value:string, corrections:Array}>}
   */
  function generateDocumentVariants(value, maxVariants) {
    const original = String(value || "").toUpperCase();
    const positions = [];

    const ambiguous = {
      O: "0",
      "0": "O",
      I: "1",
      L: "1",
      "1": "I",
      B: "8",
      "8": "B",
      S: "5",
      "5": "S",
      Z: "2",
      "2": "Z",
      G: "6",
      "6": "G"
    };

    for (let i = 0; i < original.length; i += 1) {
      if (ambiguous[original[i]]) {
        positions.push(i);
      }
    }

    const variants = [];

    function build(index, current, corrections) {
      if (variants.length >= maxVariants) return;

      if (index >= positions.length) {
        variants.push({
          value: current.join(""),
          corrections
        });
        return;
      }

      const position = positions[index];
      const oldChar = current[position];
      const newChar = ambiguous[oldChar];

      build(index + 1, current, corrections);

      const copy = current.slice();
      copy[position] = newChar;

      build(index + 1, copy, corrections.concat([{
        index: position,
        original: oldChar,
        corrected: newChar
      }]));
    }

    build(0, original.split(""), []);

    return variants;
  }

  /**
   * Returns a normalized correction record for parser output.
   * @param {string} field
   * @param {string} original
   * @param {string} corrected
   * @returns {{field:string, original:string, corrected:string}}
   */
  function correctionRecord(field, original, corrected) {
    return {
      field,
      original,
      corrected
    };
  }

  window.PVV.CheckDigit = {
    compute,
    validate,
    charValue,
    correctDigitField,
    correctAlphaField,
    correctWithCheckDigit,
    correctionRecord
  };
})(window);
