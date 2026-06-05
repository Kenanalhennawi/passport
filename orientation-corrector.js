// orientation-corrector.js
(function (window) {
  "use strict";

  window.PVV = window.PVV || {};

  /**
   * Detect and correct image orientation by looking for MRZ patterns.
   * @param {string} imageDataUrl - Input image (data URL)
   * @returns {Promise<string>} - Corrected image data URL (or original if unchanged)
   */
  async function correctOrientation(imageDataUrl) {
    try {
      const orientations = [0, 90, 180, 270];
      let bestOrientation = 0;
      let bestScore = -1;

      for (const angle of orientations) {
        const rotated = await rotateImage(imageDataUrl, angle);
        const score = await scoreMrzPattern(rotated);
        if (score > bestScore) {
          bestScore = score;
          bestOrientation = angle;
        }
      }

      // If no orientation yields a decent score (e.g., all < 10), return original
      if (bestOrientation !== 0 && bestScore > 15) {
        return await rotateImage(imageDataUrl, bestOrientation);
      }
      return imageDataUrl;
    } catch (error) {
      console.warn("Orientation correction failed, using original image:", error);
      return imageDataUrl;
    }
  }

  /**
   * Rotate an image by a given angle (0, 90, 180, 270 degrees).
   * @param {string} dataUrl
   * @param {number} angle
   * @returns {Promise<string>}
   */
  function rotateImage(dataUrl, angle) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        if (angle === 90 || angle === 270) {
          canvas.width = img.height;
          canvas.height = img.width;
        } else {
          canvas.width = img.width;
          canvas.height = img.height;
        }

        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((angle * Math.PI) / 180);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);

        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  /**
   * Score an image by checking for MRZ patterns (P<, V<, A<) using Tesseract on a small region.
   * @param {string} dataUrl
   * @returns {Promise<number>}
   */
  async function scoreMrzPattern(dataUrl) {
    if (!window.Tesseract) return 0;

    // Downsample to speed up detection (max 800px wide)
    const downsampled = await downsampleImage(dataUrl, 800);
    const { data: { text } } = await window.Tesseract.recognize(downsampled, "eng", {
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
      logger: m => {} // silent
    });

    const upperText = (text || "").toUpperCase();
    let score = 0;
    if (upperText.includes("P<")) score += 30;
    if (upperText.includes("V<")) score += 25;
    if (upperText.includes("A<")) score += 20;
    if (upperText.includes("<<") && upperText.length > 20) score += 15;

    // Also reward presence of MRZ‑like lines
    const lines = upperText.split("\n");
    for (const line of lines) {
      if (line.length >= 30 && line.replace(/[^A-Z0-9<]/g, "").length >= 30) {
        score += 10;
        break;
      }
    }
    return score;
  }

  function downsampleImage(dataUrl, maxWidth) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.6));
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  window.PVV.OrientationCorrector = {
    correctOrientation
  };
})(window);
