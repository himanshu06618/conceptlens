/**
 * Downscales very large mobile photos (e.g. 12MP/48MP camera shots)
 * to a max dimension of 2500px with 0.85 JPEG quality before upload.
 * Preserves crisp text resolution for OCR while reducing upload size by up to 90%.
 */
export async function compressImageIfNeeded(file, maxDimension = 2500, quality = 0.85) {
  // Only process image files
  if (!file.type.startsWith('image/')) {
    return file;
  }

  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;

      // If already within limits and reasonably sized, do not compress
      if (width <= maxDimension && height <= maxDimension && file.size < 4 * 1024 * 1024) {
        return resolve(file);
      }

      // Calculate scaled dimensions
      if (width > maxDimension || height > maxDimension) {
        if (width > height) {
          height = Math.round((height * maxDimension) / width);
          width = maxDimension;
        } else {
          width = Math.round((width * maxDimension) / height);
          height = maxDimension;
        }
      }

      // Draw onto offscreen canvas
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            return resolve(file);
          }
          // Preserve filename with .jpg extension if converted
          const newName = file.name.replace(/\.[^/.]+$/, '') + '.jpg';
          const compressedFile = new File([blob], newName, {
            type: 'image/jpeg',
            lastModified: Date.now(),
          });
          resolve(compressedFile);
        },
        'image/jpeg',
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file); // Fallback to original on error
    };

    img.src = objectUrl;
  });
}
