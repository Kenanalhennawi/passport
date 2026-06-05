// pdf-reader.js
(function (window) {
  "use strict";

  window.PVV = window.PVV || {};

  /**
   * Convert a file (image or PDF) to an array of image data URLs.
   * @param {File} file
   * @param {object} options
   * @param {number} options.maxPages - Max pages to read (default 5)
   * @param {number} options.scale - PDF render scale (default 2.5)
   * @param {number[]} options.pageNumbers - Array of 1‑based page numbers to extract (e.g., [2]). If empty, process all up to maxPages.
   * @returns {Promise<string[]>}
   */
  async function fileToImageDataUrls(file, options = {}) {
    const maxPages = options.maxPages || 5;
    const scale = options.scale || 2.5;
    let pageNumbers = options.pageNumbers || [];

    if (!file) {
      throw new Error("No file selected.");
    }

    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      return await pdfToImages(file, maxPages, scale, pageNumbers);
    }

    if (file.type.startsWith("image/")) {
      return [await imageFileToDataUrl(file)];
    }

    throw new Error("Unsupported file type. Please upload an image or PDF.");
  }

  /**
   * Convert an image file to a data URL.
   * @param {File} file
   * @returns {Promise<string>}
   */
  function imageFileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Unable to read image file."));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Convert a PDF file to an array of image data URLs for selected pages.
   * @param {File} file
   * @param {number} maxPages
   * @param {number} scale
   * @param {number[]} pageNumbers
   * @returns {Promise<string[]>}
   */
  async function pdfToImages(file, maxPages, scale, pageNumbers) {
    if (!window.pdfjsLib) {
      throw new Error("PDF engine is not loaded.");
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const totalPages = pdf.numPages;

    let pagesToProcess = [];
    if (pageNumbers && pageNumbers.length) {
      pagesToProcess = pageNumbers
        .map(p => Number(p))
        .filter(p => p >= 1 && p <= totalPages && p <= maxPages);
      pagesToProcess = [...new Set(pagesToProcess)].sort((a, b) => a - b);
    } else {
      const limit = Math.min(totalPages, maxPages);
      for (let i = 1; i <= limit; i++) pagesToProcess.push(i);
    }

    if (pagesToProcess.length === 0) {
      throw new Error("No valid pages selected (max " + maxPages + " pages).");
    }

    const images = [];
    for (const pageNum of pagesToProcess) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: context, viewport }).promise;
      images.push(canvas.toDataURL("image/png", 1));
    }
    return images;
  }

  window.PVV.PdfReader = {
    fileToImageDataUrls
  };
})(window);
