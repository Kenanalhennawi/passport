(function (window) {
  "use strict";

  window.PVV = window.PVV || {};

  async function fileToImageDataUrls(file, options = {}) {
    const maxPages = options.maxPages || 3;
    const scale = options.scale || 2.5;

    if (!file) {
      throw new Error("No file selected.");
    }

    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      return await pdfToImages(file, maxPages, scale);
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

  async function pdfToImages(file, maxPages, scale) {
    if (!window.pdfjsLib) {
      throw new Error("PDF engine is not loaded.");
    }

    const arrayBuffer = await file.arrayBuffer();

    const pdf = await window.pdfjsLib.getDocument({
      data: arrayBuffer
    }).promise;

    const totalPages = Math.min(pdf.numPages, maxPages);
    const images = [];

    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      await page.render({
        canvasContext: context,
        viewport
      }).promise;

      images.push(canvas.toDataURL("image/png", 1));
    }

    return images;
  }

  window.PVV.PdfReader = {
    fileToImageDataUrls
  };
})(window);
