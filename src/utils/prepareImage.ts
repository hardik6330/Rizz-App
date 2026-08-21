import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { ImagePickerAsset } from 'expo-image-picker';

import { resizeFor } from './resizeFor';

/**
 * Turn a picked photo into the `{ base64, mimeType }` the AI routes take.
 *
 * ## Why this exists
 *
 * Both pickers used to ask ImagePicker for `base64: true` on the untouched
 * original. A 6.9" iPhone screenshot is 1290×2796; base64 adds a third on top of
 * the JPEG, and Profile Scan held up to three of them as JS strings before
 * `JSON.stringify` copied the lot again for the request body. Two consequences,
 * both worse on iOS because iPhone screenshots are the largest:
 *
 * 1. A memory spike and a stringify stall on the JS thread, mid-interaction.
 * 2. `routes/ai.ts` caps one image at `MAX_B64 = 4 MB` and zod rejects past it —
 *    so a photo-heavy profile screenshot came back to the user as
 *    `"images[1..3] and mode are required"`, which describes nothing that
 *    happened to them.
 *
 * That server file's own comment already asserted *"the client already downscales
 * to 1280px/JPEG 80"*. It did not. This is that sentence becoming true — see
 * `resizeFor.ts` for why the number is 2048 and not 1280.
 */

/** JPEG quality. Chat text stays crisp here; artefacts show below ~0.7. */
const QUALITY = 0.8;

/**
 * Always JPEG, so the mime type is known rather than guessed.
 *
 * The call sites used to send `asset.mimeType ?? 'image/jpeg'` — a guess that is
 * wrong for the HEIC and PNG the library hands back, and the server passes
 * whatever it is told straight to Gemini as `mime_type`.
 */
const MIME = 'image/jpeg';

export interface PreparedImage {
  base64: string;
  mimeType: string;
}

/**
 * Throws on a manipulation failure rather than falling back to the original.
 *
 * Same rule as §4.5: the callers catch and toast, and a user who sees an error is
 * better off than one silently charged a credit for a request the server is about
 * to reject at 4 MB.
 */
export async function prepareImage(asset: ImagePickerAsset): Promise<PreparedImage> {
  const context = ImageManipulator.manipulate(asset.uri);

  // `width`/`height` ride along on the picked asset — no extra decode to measure.
  const resize = resizeFor(asset.width, asset.height);
  if (resize) context.resize(resize);

  const image = await context.renderAsync();
  const saved = await image.saveAsync({ base64: true, compress: QUALITY, format: SaveFormat.JPEG });

  if (!saved.base64) throw new Error('prepareImage: manipulator returned no base64');
  return { base64: saved.base64, mimeType: MIME };
}
