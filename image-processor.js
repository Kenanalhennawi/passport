export async function preprocessImageForOcr(file) {
  const image = await loadImage(file);
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

function loadImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("Invalid image file."));
      return;
    }

    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to load image."));
    };

    img.src = url;
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