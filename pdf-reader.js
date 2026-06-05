// pdf-reader.js
(function (window) {
  "use strict";

  window.PVV = window.PVV || {};

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

  function imageFileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Unable to read image file."));
      reader.readAsDataURL(file);
    });
  }

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
      pagesToProcess = [...new Set(pagesToProcess)].sort((a,b) => a - b);
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
