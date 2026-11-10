// =============================================================================
// Fase R — reglas PURAS de compresión de imágenes (sin APIs del navegador,
// testeables con `node --test`). La parte que usa canvas está en
// imageCompression.ts.
// =============================================================================

export const MAX_DIMENSION = 1920;
export const JPEG_QUALITY = 0.8;
export const ACCEPTED_INPUT_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
/** PNG sin transparencia por debajo de este tamaño se conserva tal cual (capturas nítidas). */
export const KEEP_SMALL_PNG_BYTES = 1024 * 1024;

export const HEIC_REJECTION_MESSAGE =
  "Las fotos HEIC (iPhone) no son compatibles. En el iPhone ve a Ajustes → Cámara → Formatos → " +
  "\"Más compatible\", o comparte la foto como JPG.";

export type OutputType = "image/jpeg" | "image/png" | "image/webp";

/** Escala proporcional para que el lado mayor no supere `max`. Nunca amplía. */
export function targetDimensions(width: number, height: number, max = MAX_DIMENSION): { width: number; height: number; resized: boolean } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0, resized: false };
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height, resized: false };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), resized: true };
}

/** ¿Es HEIC/HEIF? (por tipo declarado o extensión; los navegadores a veces dejan el tipo vacío). */
export function isHeic(file: { type?: string; name?: string }): boolean {
  return /^image\/hei[cf]/i.test(file.type ?? "") || /\.(heic|heif)$/i.test(file.name ?? "");
}

export function isAcceptedInput(file: { type?: string; name?: string }): boolean {
  if (ACCEPTED_INPUT_TYPES.includes((file.type ?? "").toLowerCase())) return true;
  return !file.type && /\.(jpe?g|png|webp)$/i.test(file.name ?? "");
}

/**
 * Formato de salida:
 *  · fotografías (JPEG, o PNG/WebP sin transparencia) → JPEG calidad 0.8;
 *  · imágenes con transparencia → PNG (o WebP si el navegador sabe codificarlo y la entrada era WebP);
 *  · PNG pequeño sin redimensionar y sin transparencia → se conserva PNG (capturas de pantalla).
 */
export function chooseOutputType(params: {
  inputType: string;
  hasAlpha: boolean;
  resized: boolean;
  inputBytes: number;
  webpEncodeSupported: boolean;
}): OutputType {
  const t = params.inputType.toLowerCase();
  if (params.hasAlpha) {
    return t === "image/webp" && params.webpEncodeSupported ? "image/webp" : "image/png";
  }
  if (t === "image/png" && !params.resized && params.inputBytes <= KEEP_SMALL_PNG_BYTES) return "image/png";
  return "image/jpeg";
}

export function extensionFor(type: OutputType): string {
  return type === "image/png" ? ".png" : type === "image/webp" ? ".webp" : ".jpg";
}

/** Nombre de archivo con la extensión del formato final. */
export function renameFor(originalName: string, type: OutputType): string {
  const base = originalName.replace(/\.[^.]+$/, "") || "imagen";
  return base + extensionFor(type);
}
