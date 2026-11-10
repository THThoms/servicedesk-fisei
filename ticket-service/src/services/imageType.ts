// =============================================================================
// Fase R — Detección del tipo REAL de imagen por sus bytes ("magic numbers").
// Nunca se confía en el MIME declarado por el cliente (Content-Type del part
// multipart) ni en la extensión del nombre de archivo.
// =============================================================================
import fs from "fs";

export type ImageMime = "image/jpeg" | "image/png" | "image/webp";
export type DetectedType = ImageMime | "image/heic" | null;

export const EXT_BY_MIME: Record<ImageMime, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

/** Analiza los primeros bytes. Devuelve null si no es una imagen reconocida. */
export function detectImageType(head: Buffer): DetectedType {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (
    head.length >= 8 &&
    head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (head.length >= 12 && head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (head.length >= 12 && head.toString("ascii", 4, 8) === "ftyp") {
    const brand = head.toString("ascii", 8, 12);
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].includes(brand)) return "image/heic";
  }
  return null;
}

export function readHead(filePath: string, bytes = 16): Buffer {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n);
  } finally {
    fs.closeSync(fd);
  }
}
