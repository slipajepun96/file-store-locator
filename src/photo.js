// Phone photos are often 4000px+ and several MB. Text reads just as well at ~2400px, so each photo (or scanned PDF
// page) is drawn at most that size and sent as JPEG: faster to send, lighter for the server.
export const MAX_SIDE = 2400;
const JPEG_QUALITY = 0.9;
// Camera photos are detailed and noisy, so even at 2400px they can be several MB. Each image is kept under this size
// (lower JPEG quality first, then fewer pixels), so it isn't refused by an upload limit on the way, such as Nginx's
// default of 1 MB. Text still reads well this way.
export const MAX_UPLOAD_BYTES = 900 * 1024;
const MIN_SIDE = 1400;

function toBlob(canvas, quality) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not prepare the image.'))), 'image/jpeg', quality)
  );
}

// The canvas as a JPEG under MAX_UPLOAD_BYTES where possible.
export async function canvasToJpeg(canvas) {
  for (const quality of [JPEG_QUALITY, 0.8, 0.7]) {
    const blob = await toBlob(canvas, quality);
    if (blob.size <= MAX_UPLOAD_BYTES) return blob;
  }
  const side = Math.max(canvas.width, canvas.height);
  if (side <= MIN_SIDE) return toBlob(canvas, 0.6);
  return canvasToJpeg(drawScaled(canvas, canvas.width, canvas.height, Math.max(MIN_SIDE, Math.round(side * 0.75)) / side));
}

function drawScaled(source, width, height, scale) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  // Transparent areas (PNG screenshots) read like paper on white.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// Opens the photo, turned upright from the camera's EXIF orientation. createImageBitmap is used where it works;
// otherwise (older iPhones, or a photo it can't open) an <img> does, which browsers also turn upright.
async function decode(file) {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { image: bitmap, width: bitmap.width, height: bitmap.height, done: () => bitmap.close() };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { image: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
    } catch {
      URL.revokeObjectURL(url);
      throw new Error(
        `"${file.name || 'This photo'}" couldn't be opened on this device. Take the photo again with the Scan button, or save it as a JPEG first.`
      );
    }
  }
}

// Shrinks a photo, turned upright. Re-encoding as JPEG also turns iPhone HEIC photos into something the server reads.
export async function shrinkPhoto(file) {
  const { image, width, height, done } = await decode(file);
  try {
    return await canvasToJpeg(drawScaled(image, width, height, Math.min(1, MAX_SIDE / Math.max(width, height))));
  } finally {
    done();
  }
}
