/**
 * Reads EXIF orientation from an image file and rotates/corrects the image accordingly.
 * @param {File|Blob} imageFile - The image file to correct.
 * @returns {Promise<string>} - Resolves with a data URL of the corrected image.
 */
export function correctOrientation(imageFile) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // Get EXIF orientation data (simplified: uses a library or basic detection)
      // For a real implementation, you would use a library like exif-js.
      // Here we provide a placeholder that just returns the original image.
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // Determine orientation (mock: no transformation)
      let orientation = 1; // Assume normal orientation for demo
      // In a real app, you would extract orientation from EXIF using e.g.:
      // EXIF.getData(img, function() { orientation = EXIF.getTag(this, 'Orientation'); });

      let width = img.width;
      let height = img.height;
      let transformWidth = width;
      let transformHeight = height;

      // Apply rotation/transformation based on orientation value
      switch (orientation) {
        case 2: // Flip horizontally
          canvas.width = width;
          canvas.height = height;
          ctx.translate(width, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(img, 0, 0);
          break;
        case 3: // Rotate 180
          canvas.width = width;
          canvas.height = height;
          ctx.translate(width, height);
          ctx.rotate(Math.PI);
          ctx.drawImage(img, 0, 0);
          break;
        case 4: // Flip vertically
          canvas.width = width;
          canvas.height = height;
          ctx.translate(0, height);
          ctx.scale(1, -1);
          ctx.drawImage(img, 0, 0);
          break;
        case 5: // Rotate 90 + flip
          canvas.width = height;
          canvas.height = width;
          ctx.translate(height, 0);
          ctx.rotate(Math.PI / 2);
          ctx.scale(-1, 1);
          ctx.drawImage(img, 0, 0);
          transformWidth = height;
          transformHeight = width;
          break;
        case 6: // Rotate 90
          canvas.width = height;
          canvas.height = width;
          ctx.translate(height, 0);
          ctx.rotate(Math.PI / 2);
          ctx.drawImage(img, 0, 0);
          transformWidth = height;
          transformHeight = width;
          break;
        case 7: // Rotate -90 + flip
          canvas.width = height;
          canvas.height = width;
          ctx.translate(0, width);
          ctx.rotate(-Math.PI / 2);
          ctx.scale(-1, 1);
          ctx.drawImage(img, 0, 0);
          transformWidth = height;
          transformHeight = width;
          break;
        case 8: // Rotate -90
          canvas.width = height;
          canvas.height = width;
          ctx.translate(0, width);
          ctx.rotate(-Math.PI / 2);
          ctx.drawImage(img, 0, 0);
          transformWidth = height;
          transformHeight = width;
          break;
        default: // No transformation
          canvas.width = width;
          canvas.height = height;
          ctx.drawImage(img, 0, 0);
      }

      canvas.toBlob((blob) => {
        const dataUrl = URL.createObjectURL(blob);
        resolve(dataUrl);
      }, 'image/jpeg');
    };

    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(imageFile);
  });
}
