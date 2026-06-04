export async function preprocessImageForOcr(fileOrDataUrl) {
  const image = await loadImage(fileOrDataUrl);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const maxWidth = 1800;
  const scale = image.width > maxWidth ? maxWidth / image.width : 1;

  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);

  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  enhanceContrast(ctx, canvas.width, canvas.height);

  return canvas.toDataURL("image/png", 0.95);
}

export async function fileToOcrImageDataUrls(file, options = {}) {
  if (!file) {
    throw new Error("No file selected.");
  }

  const maxPages = options.maxPages || 3;
  const scale = options.scale || 2.5;

  if (isPdfFile(file)) {
    return await pdfToImageDataUrls(file, maxPages, scale);
  }

  if (file.type && file.type.startsWith("image/")) {
    return [await fileToDataUrl(file)];
  }

  throw new Error("Unsupported file type. Please upload an image or PDF.");
}

function isPdfFile(file) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

async function pdfToImageDataUrls(file, maxPages, scale) {
  if (!window.pdfjsLib) {
    throw new Error("PDF engine is not loaded. Check PDF.js script in index.html.");
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
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);

    await page.render({
      canvasContext: ctx,
      viewport
    }).promise;

    images.push(canvas.toDataURL("image/png", 1));
  }

  if (!images.length) {
    throw new Error("PDF does not contain readable pages.");
  }

  return images;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Unable to read file."));

    reader.readAsDataURL(file);
  });
}

function loadImage(fileOrDataUrl) {
  return new Promise((resolve, reject) => {
    if (!fileOrDataUrl) {
      reject(new Error("Invalid image source."));
      return;
    }

    const img = new Image();

    img.onload = () => resolve(img);

    img.onerror = () => {
      reject(new Error("Unable to load image."));
    };

    if (typeof fileOrDataUrl === "string") {
      img.src = fileOrDataUrl;
      return;
    }

    if (fileOrDataUrl.type && fileOrDataUrl.type.startsWith("image/")) {
      const url = URL.createObjectURL(fileOrDataUrl);

      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Unable to load image."));
      };

      img.src = url;
      return;
    }

    reject(new Error("Invalid image file."));
  });
}

function enhanceContrast(ctx, width, height) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  const contrast = 1.18;
  const brightness = 8;

  for (let i = 0; i < data.length; i += 4) {
    data[i] = clamp((data[i] - 128) * contrast + 128 + brightness);
    data[i + 1] = clamp((data[i + 1] - 128) * contrast + 128 + brightness);
    data[i + 2] = clamp((data[i + 2] - 128) * contrast + 128 + brightness);
  }

  ctx.putImageData(imageData, 0, 0);
}

function clamp(value) {
  return Math.max(0, Math.min(255, value));
}
