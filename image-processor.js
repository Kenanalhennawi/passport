import { correctOrientation } from "./orientation-corrector.js";

const MAX_FILE_SIZE_MB = 15;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const MAX_PDF_PAGES = 3;
const PDF_RENDER_SCALE = 2.5;
const MAX_CANVAS_PIXELS = 25000000;

export async function preprocessImageForOcr(fileOrDataUrl) {
  const image = await loadImage(fileOrDataUrl);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const maxWidth = 1800;
  const scale = image.width > maxWidth ? maxWidth / image.width : 1;

  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);

  protectCanvasSize(canvas.width, canvas.height);

  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  enhanceContrast(ctx, canvas.width, canvas.height);

  return canvas.toDataURL("image/png", 0.95);
}

export async function fileToOcrImageDataUrls(file, options = {}) {
  validateIncomingFile(file);

  const maxPages = options.maxPages || MAX_PDF_PAGES;
  const scale = options.scale || PDF_RENDER_SCALE;

  if (isPdfFile(file)) {
    await validatePdfMagic(file);
    return await pdfToImageDataUrls(file, maxPages, scale);
  }

  if (isImageFile(file)) {
    await validateImageMagic(file);

    const corrected = await tryCorrectImageOrientation(file);

    return [corrected];
  }

  throw new Error("Unsupported file type. Please upload an image or PDF.");
}

function validateIncomingFile(file) {
  if (!file) {
    throw new Error("No file selected.");
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(`File is too large. Maximum allowed size is ${MAX_FILE_SIZE_MB} MB.`);
  }

  if (!isPdfFile(file) && !isImageFile(file)) {
    throw new Error("Unsupported file type. Please upload JPG, PNG, WEBP, or PDF.");
  }
}

function isPdfFile(file) {
  return (
    file.type === "application/pdf" ||
    String(file.name || "").toLowerCase().endsWith(".pdf")
  );
}

function isImageFile(file) {
  return Boolean(file.type && file.type.startsWith("image/"));
}

async function validatePdfMagic(file) {
  const header = await readFileHeader(file, 5);
  const signature = bytesToAscii(header);

  if (signature !== "%PDF-") {
    throw new Error("Invalid PDF file. The file extension says PDF but the content is not a valid PDF.");
  }
}

async function validateImageMagic(file) {
  const header = await readFileHeader(file, 12);

  if (isJpegHeader(header)) return;
  if (isPngHeader(header)) return;
  if (isWebpHeader(header)) return;
  if (isGifHeader(header)) return;

  if (file.type && file.type.startsWith("image/")) {
    return;
  }

  throw new Error("Invalid image file. Please upload JPG, PNG, WEBP, or another supported image.");
}

function readFileHeader(file, length) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const blob = file.slice(0, length);

    reader.onload = () => {
      resolve(new Uint8Array(reader.result));
    };

    reader.onerror = () => {
      reject(new Error("Unable to read file header."));
    };

    reader.readAsArrayBuffer(blob);
  });
}

function bytesToAscii(bytes) {
  return Array.from(bytes)
    .map((byte) => String.fromCharCode(byte))
    .join("");
}

function isJpegHeader(bytes) {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isPngHeader(bytes) {
  return (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

function isWebpHeader(bytes) {
  const ascii = bytesToAscii(bytes);
  return ascii.startsWith("RIFF") && ascii.includes("WEBP");
}

function isGifHeader(bytes) {
  const ascii = bytesToAscii(bytes);
  return ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a");
}

async function tryCorrectImageOrientation(file) {
  try {
    if (typeof correctOrientation === "function") {
      const corrected = await correctOrientation(file);

      if (typeof corrected === "string") {
        return corrected;
      }

      if (corrected instanceof Blob || corrected instanceof File) {
        return await fileToDataUrl(corrected);
      }

      if (corrected instanceof HTMLCanvasElement) {
        return corrected.toDataURL("image/png", 0.95);
      }
    }
  } catch (error) {
    console.warn("Orientation correction failed. Using original image.", error);
  }

  return await fileToDataUrl(file);
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
    let viewport = page.getViewport({ scale });

    let width = Math.round(viewport.width);
    let height = Math.round(viewport.height);

    if (width * height > MAX_CANVAS_PIXELS) {
      const safeScale = Math.sqrt(MAX_CANVAS_PIXELS / (width * height)) * scale;
      viewport = page.getViewport({ scale: safeScale });
      width = Math.round(viewport.width);
      height = Math.round(viewport.height);
    }

    protectCanvasSize(width, height);

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    canvas.width = width;
    canvas.height = height;

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

    reader.onerror = () => {
      reject(new Error("Unable to read image file."));
    };

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

    if (fileOrDataUrl instanceof Blob || fileOrDataUrl instanceof File) {
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

function protectCanvasSize(width, height) {
  if (width <= 0 || height <= 0) {
    throw new Error("Invalid image dimensions.");
  }

  if (width * height > MAX_CANVAS_PIXELS) {
    throw new Error("Image is too large to process safely in the browser.");
  }
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
