import { z } from "zod";

// Photos travel as data URLs inside the job or dispute document (no file
// storage is configured), so each one is capped well under Firestore's 1 MB
// document limit. The frontend downsizes images before sending them.
export const MAX_PHOTOS = 3;
export const MAX_PHOTO_CHARS = 300_000;

export const photoSchema = z
  .string({ error: "each photo must be an image data URL" })
  .regex(/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/]+=*$/, "photos must be PNG, JPEG or WebP images")
  .max(MAX_PHOTO_CHARS, "each photo must be smaller than about 220 KB");

export const photosSchema = z
  .array(photoSchema, { error: "photos must be a list" })
  .max(MAX_PHOTOS, `at most ${MAX_PHOTOS} photos`);
