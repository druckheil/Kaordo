// Fits native Cropper selections to image bounds and exports exact-size WebP images

import type { CropperCanvas, CropperImage, CropperSelection } from 'cropperjs';

export function fitCropperSelection(image: CropperImage, canvas: CropperCanvas, selection: CropperSelection, aspectRatio: number): boolean {
  image.$center('contain');
  const parent = canvas.getBoundingClientRect();
  const picture = image.getBoundingClientRect();
  const left = Math.max(0, picture.left - parent.left);
  const top = Math.max(0, picture.top - parent.top);
  const right = Math.max(0, parent.right - picture.right);
  const bottom = Math.max(0, parent.bottom - picture.bottom);
  const width = Math.min(parent.width - left - right, (parent.height - top - bottom) * aspectRatio) * .9;
  const height = width / aspectRatio;
  // Native inset constraints keep pointer, wheel and keyboard changes inside the image.
  selection.minInset = `${top}px ${right}px ${bottom}px ${left}px`;
  selection.$change(left + (parent.width - left - right - width) / 2,
    top + (parent.height - top - bottom - height) / 2, width, height, aspectRatio);
  return width > 0 && height > 0;
}

export async function exportCroppedImage(selection: CropperSelection, width: number, height: number): Promise<File> {
  const canvas = await selection.$toCanvas({
    width, height,
    beforeDraw(_context, canvas) {
      // Canvas sizes are integers; avoid truncating floating-point ratio adjustments.
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }
  });
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error('Could not crop this image.')), 'image/webp', .9);
  });
  return new File([blob], 'profile-image.webp', { type: blob.type });
}
