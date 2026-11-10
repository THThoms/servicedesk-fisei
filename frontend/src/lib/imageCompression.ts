// =============================================================================
// Fase R — compresión de imágenes en el cliente antes de subirlas.
//   · lado mayor ≤ 1920 px · JPEG 0.8 para fotos · PNG si hay transparencia
//   · WebP admitido como entrada · HEIC rechazado con mensaje comprensible
//   · respeta la orientación EXIF y elimina metadatos (p. ej. GPS) al recodificar
// Funciona igual en el navegador y en el WebView de Android (Capacitor).
// El backend vuelve a validar el tipo real por bytes: esto es comodidad y
// ahorro de datos, no un control de seguridad.
// =============================================================================
import {
  HEIC_REJECTION_MESSAGE,
  JPEG_QUALITY,
  chooseOutputType,
  isAcceptedInput,
  isHeic,
  renameFor,
  targetDimensions,
  type OutputType,
} from "./imageCompressionCore";

export class ImageRejectedError extends Error {}

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* algunos WebView antiguos no aceptan opciones: se intenta con <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode"));
      el.src = url;
    });
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  // Muestra reducida (≤256 px) para no recorrer millones de píxeles.
  const sw = Math.min(w, 256);
  const sh = Math.min(h, 256);
  const probe = document.createElement("canvas");
  probe.width = sw;
  probe.height = sh;
  const pctx = probe.getContext("2d");
  if (!pctx) return false;
  pctx.drawImage(ctx.canvas, 0, 0, sw, sh);
  const data = pctx.getImageData(0, 0, sw, sh).data;
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
}

let webpSupport: boolean | null = null;
function canEncodeWebp(): boolean {
  if (webpSupport === null) {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    webpSupport = c.toDataURL("image/webp").startsWith("data:image/webp");
  }
  return webpSupport;
}

function toBlob(canvas: HTMLCanvasElement, type: OutputType): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), type, type === "image/png" ? undefined : JPEG_QUALITY)
  );
}

/** Devuelve la imagen lista para subir, o lanza ImageRejectedError con un mensaje para el usuario. */
export async function prepareImageForUpload(file: File): Promise<File> {
  if (isHeic(file)) throw new ImageRejectedError(HEIC_REJECTION_MESSAGE);
  if (!isAcceptedInput(file)) throw new ImageRejectedError(`"${file.name}" no es una imagen JPG, PNG o WebP.`);

  let decoded;
  try {
    decoded = await decode(file);
  } catch {
    throw new ImageRejectedError(`"${file.name}" no se pudo leer como imagen (¿archivo dañado?).`);
  }
  try {
    const dims = targetDimensions(decoded.width, decoded.height);
    const canvas = document.createElement("canvas");
    canvas.width = dims.width;
    canvas.height = dims.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file; // sin canvas: se sube el original (el backend lo valida igualmente)
    ctx.drawImage(decoded.source, 0, 0, dims.width, dims.height);

    const inputType = (file.type || "image/jpeg").replace("image/jpg", "image/jpeg");
    const alpha = inputType !== "image/jpeg" && hasTransparency(ctx, dims.width, dims.height);
    const type = chooseOutputType({
      inputType, hasAlpha: alpha, resized: dims.resized, inputBytes: file.size, webpEncodeSupported: canEncodeWebp(),
    });
    if (type === "image/png" && inputType === "image/png" && !dims.resized) return file; // ya óptimo
    const blob = await toBlob(canvas, type);
    // Si recodificar no aporta (imagen ya pequeña y en el mismo formato), se conserva el original.
    if (!dims.resized && blob.size >= file.size && type === inputType) return file;
    return new File([blob], renameFor(file.name, type), { type, lastModified: Date.now() });
  } finally {
    decoded.close();
  }
}
