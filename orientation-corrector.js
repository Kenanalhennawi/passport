/**
 * orientation-corrector.js
 * Provides a named export `correctOrientation` to fix image orientation based on EXIF data.
 */

export function correctOrientation(imageFile) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // Helper: read EXIF orientation tag from JPEG
      const getOrientation = (file, callback) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const view = new DataView(e.target.result);
          if (view.getUint16(0, false) !== 0xFFD8) {
            return callback(1); // not JPEG
          }
          let offset = 2;
          while (offset < view.byteLength) {
            if (view.getUint16(offset, false) !== 0xFFE1) {
              offset += view.getUint16(offset + 2, false) + 2;
              continue;
            }
            // EXIF marker found
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
              if (tag === 0x0112) { // Orientation
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
        reader.readAsArrayBuffer(file.slice(0, 128 * 1024));
      };

      getOrientation(imageFile, (orientation) => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        let width = img.width;
        let height = img.height;
        let outputWidth = width;
        let outputHeight = height;

        // Reset transform
        ctx.setTransform(1, 0, 0, 1, 0, 0);

        switch (orientation) {
          case 2: // horizontal flip
            canvas.width = width;
            canvas.height = height;
            ctx.translate(width, 0);
            ctx.scale(-1, 1);
            ctx.drawImage(img, 0, 0);
            break;
          case 3: // 180° rotation
            canvas.width = width;
            canvas.height = height;
            ctx.translate(width, height);
            ctx.rotate(Math.PI);
            ctx.drawImage(img, 0, 0);
            break;
          case 4: // vertical flip
            canvas.width = width;
            canvas.height = height;
            ctx.translate(0, height);
            ctx.scale(1, -1);
            ctx.drawImage(img, 0, 0);
            break;
          case 5: // 90° + flip
            canvas.width = height;
            canvas.height = width;
            ctx.translate(height, 0);
            ctx.rotate(Math.PI / 2);
            ctx.scale(-1, 1);
            ctx.drawImage(img, 0, 0);
            outputWidth = height;
            outputHeight = width;
            break;
          case 6: // 90° clockwise
            canvas.width = height;
            canvas.height = width;
            ctx.translate(height, 0);
            ctx.rotate(Math.PI / 2);
            ctx.drawImage(img, 0, 0);
            outputWidth = height;
            outputHeight = width;
            break;
          case 7: // -90° + flip
            canvas.width = height;
            canvas.height = width;
            ctx.translate(0, width);
            ctx.rotate(-Math.PI / 2);
            ctx.scale(-1, 1);
            ctx.drawImage(img, 0, 0);
            outputWidth = height;
            outputHeight = width;
            break;
          case 8: // 90° counter-clockwise
            canvas.width = height;
            canvas.height = width;
            ctx.translate(0, width);
            ctx.rotate(-Math.PI / 2);
            ctx.drawImage(img, 0, 0);
            outputWidth = height;
            outputHeight = width;
            break;
          default: // orientation 1 – normal
            canvas.width = width;
            canvas.height = height;
            ctx.drawImage(img, 0, 0);
        }

        // Return as data URL
        canvas.toBlob((blob) => {
          const url = URL.createObjectURL(blob);
          resolve(url);
        }, 'image/jpeg', 0.92);
      });
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(imageFile);
  });
}
