// Phone photos are often 4000px+ and several MB. Text reads just as well at ~2400px, so each photo (or scanned PDF
// page) is drawn at most that size and sent as JPEG: faster to send, lighter for the server.
export const MAX_SIDE = 2400;
const JPEG_QUALITY = 0.9;

export function canvasToJpeg(canvas) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not prepare the image.'))), 'image/jpeg', JPEG_QUALITY)
  );
}

// Shrinks a photo, turned upright from the camera's EXIF orientation. Re-encoding as JPEG also turns iPhone HEIC
// photos into something the server reads.
export async function shrinkPhoto(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvasToJpeg(canvas);
}
