// orientation-corrector.js
// Corrects image orientation based on EXIF data.

/**
 * Reads EXIF orientation from an image file and returns a corrected image as a data URL.
 * @param {File|Blob} imageFile - The image file to correct.
 * @returns {Promise<string>} - Resolves with a data URL of the corrected image.
 */
export function correctOrientation(imageFile) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // Create a canvas to draw the corrected image
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // Default orientation = 1 (normal)
      let orientation = 1;
      let width = img.width;
      let height = img.height;
      let transformWidth = width;
      let transformHeight = height;

      // Attempt to read EXIF orientation using a simple DataView approach
      // This is a basic implementation; for production consider exif-js or similar.
      const getOrientation = (file, callback) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const view = new DataView(e.target.result);
          if (view.getUint16(0, false) !== 0xFFD8) {
            return callback(1); // Not JPEG, assume orientation 1
          }
          let offset = 2;
          let markerLength = 0;
          while (offset < view.byteLength) {
            if (view.getUint16(offset, false) !== 0xFFE1) {
              offset += view.getUint16(offset + 2, false) + 2;
              continue;
            }
            // Found EXIF APP1 marker
            const exifOffset = offset + 4;
            if (view.getUint32(exifOffset, false) !== 0x45786966) {
              return callback(1);
            }
            const tiffOffset = exifOffset + 6;
            const littleEndian = view.getUint16(tiffOffset, false) === 0x4949;
            const firstIfdOffset = view.getUint32(tiffOffset + 4, littleEndian);
            const ifdStart = tiffOffset + firstIfdOffset;
            const numEntries = view.getUint16(ifdStart, littleEndian);
            for (let i = 0; i < numEntries; i++) {
              const entryOffset = ifdStart + 2 + i * 12;
              const tag = view.getUint16(entryOffset, littleEndian);
              if (tag === 0x0112) { // Orientation tag
                const valueOffset = view.getUint32(entryOffset + 8, littleEndian);
                const orientationValue = view.getUint16(ifdStart + valueOffset, littleEndian);
                return callback(orientationValue);
              }
            }
            return callback(1);
          }
          callback(1);
        };
        reader.onerror = () => callback(1);
        reader.readAsArrayBuffer(file.slice(0, 64 * 1024)); // Read first 64KB
      };

      getOrientation(imageFile, (orient) => {
        orientation = orient;

        // Apply transformation based on orientation
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

        // Convert canvas to data URL (JPEG)
        canvas.toBlob((blob) => {
          const dataUrl = URL.createObjectURL(blob);
          resolve(dataUrl);
        }, 'image/jpeg', 0.92);
      });
    };

    img.onerror = () => reject(new Error('Failed to load image for orientation correction'));
    img.src = URL.createObjectURL(imageFile);
  });
}
