// Sprint 3+ - Almacenamiento de imágenes adjuntas a tickets.
//
// Interfaz abstracta con dos implementaciones:
//   - LocalStorage       (default): disco del contenedor, URL relativa.
//   - CloudinaryStorage  (opcional): CDN externo, URL absoluta HTTPS.
//
// Reglas:
//   - Nunca se guardan imágenes como Base64.
//   - La BD guarda `imageUrl` (fuente única) + `storageProvider` para saber
//     dónde vive físicamente. `filePath` se conserva por compat retroactiva.
//   - Cloudinary se carga con lazy require: si el paquete `cloudinary` no
//     está instalado o falta configuración, se degrada a `local` con warning.
//   - Los adjuntos históricos (solo `filePath`) siguen funcionando: el caller
//     debe resolver la URL con `resolveImageUrl(attachment)` (helper abajo).
//   - Nunca se loguean credenciales.

import fs from "fs";
import path from "path";
import { env } from "../config/env";

export interface StoredImage {
  /** URL pública para consumir la imagen. Relativa (local) o absoluta (cdn). */
  imageUrl: string;
  /**
   * Ruta interna (solo para storage local; en cloud queda undefined).
   * Se conserva en BD para poder borrar el archivo físico si el ticket se elimina.
   */
  filePath?: string;
  storageProvider: "local" | "cloudinary";
}

export interface StorageAdapter {
  readonly provider: "local" | "cloudinary";
  /**
   * Sube una imagen a partir del archivo temporal que multer dejó en disco.
   * En modo local no mueve el archivo (ya está en el destino final).
   * En cloudinary sube el binario y borra el temporal.
   */
  upload(file: Express.Multer.File): Promise<StoredImage>;
}

// -----------------------------------------------------------------------------
// LocalStorage: multer.diskStorage ya guardó el archivo en env.uploadDir.
// Solo devolvemos la URL relativa que el frontend consume vía express.static.
// -----------------------------------------------------------------------------
class LocalStorage implements StorageAdapter {
  readonly provider = "local" as const;
  async upload(file: Express.Multer.File): Promise<StoredImage> {
    const filename = path.basename(file.path);
    return {
      imageUrl: `/uploads/${filename}`,
      filePath: filename,
      storageProvider: "local",
    };
  }
}

// -----------------------------------------------------------------------------
// CloudinaryStorage: sube el binario del archivo temporal a Cloudinary y borra
// el archivo local. La API key/secret nunca aparecen en logs ni en respuestas.
// -----------------------------------------------------------------------------
type CloudinaryUploadFn = (
  filePath: string,
  options: Record<string, unknown>
) => Promise<{ secure_url: string; public_id: string }>;

class CloudinaryStorage implements StorageAdapter {
  readonly provider = "cloudinary" as const;
  private configuredPromise: Promise<CloudinaryUploadFn> | null = null;

  private async getUploader(): Promise<CloudinaryUploadFn> {
    if (this.configuredPromise) return this.configuredPromise;
    this.configuredPromise = (async () => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { v2: cloudinary } = require("cloudinary");
      cloudinary.config({
        cloud_name: env.storage.cloudinary.cloudName,
        api_key: env.storage.cloudinary.apiKey,
        api_secret: env.storage.cloudinary.apiSecret,
        secure: true,
      });
      return (filePath: string, options: Record<string, unknown>) =>
        cloudinary.uploader.upload(filePath, options);
    })();
    return this.configuredPromise;
  }

  async upload(file: Express.Multer.File): Promise<StoredImage> {
    const uploader = await this.getUploader();
    const result = await uploader(file.path, {
      folder: env.storage.cloudinary.folder,
      resource_type: "image",
      // Cloudinary genera public_id único; no reutilizamos el nombre del cliente.
      use_filename: false,
      unique_filename: true,
      overwrite: false,
    });
    // Borramos el temporal local — la imagen ya vive en el CDN.
    try {
      fs.unlinkSync(file.path);
    } catch {
      /* no bloquear si falla el unlink */
    }
    return {
      imageUrl: result.secure_url,
      filePath: undefined,
      storageProvider: "cloudinary",
    };
  }
}

// -----------------------------------------------------------------------------
// Selección del adapter. Tolerante: si "cloudinary" está pedido pero el
// paquete no está instalado o faltan credenciales, cae a "local" con warning.
// -----------------------------------------------------------------------------
let cached: StorageAdapter | null = null;

export function getStorageAdapter(): StorageAdapter {
  if (cached) return cached;
  const mode = env.storage.mode;
  if (mode === "cloudinary") {
    const c = env.storage.cloudinary;
    if (!c.cloudName || !c.apiKey || !c.apiSecret) {
      console.warn(
        "[storage] STORAGE_MODE=cloudinary pero faltan credenciales. Cayendo a modo 'local'."
      );
      cached = new LocalStorage();
    } else {
      try {
        require.resolve("cloudinary");
        cached = new CloudinaryStorage();
      } catch {
        console.warn(
          "[storage] STORAGE_MODE=cloudinary pero el paquete 'cloudinary' no está instalado. " +
            "Cayendo a modo 'local'. Ejecuta `npm install cloudinary` en ticket-service."
        );
        cached = new LocalStorage();
      }
    }
  } else {
    cached = new LocalStorage();
  }
  return cached;
}

/** Solo para tests: permite inyectar un adapter específico. */
export function __setStorageAdapterForTests(a: StorageAdapter | null): void {
  cached = a;
}

/**
 * Devuelve la URL pública consumible por el frontend para un adjunto.
 * Prioriza `imageUrl` (nuevo esquema); cae a `/uploads/${filePath}` para
 * adjuntos históricos que solo tienen filePath.
 */
export function resolveImageUrl(
  attachment: { imageUrl?: string | null; filePath?: string | null }
): string | null {
  if (attachment.imageUrl) return attachment.imageUrl;
  if (attachment.filePath) return `/uploads/${attachment.filePath}`;
  return null;
}

/**
 * Sprint L · P2 — serializa un attachment para el frontend con una URL
 * consumible desde el navegador SIN exponer `/uploads/*` ni depender de la
 * red interna de Docker.
 *
 *   · Cloudinary (imageUrl absoluta https://...):  se devuelve tal cual, el
 *     CDN es público.
 *   · Local (filePath + imageUrl `/uploads/x`):    se devuelve un endpoint
 *     autenticado del propio gateway:
 *         /api/tickets/{ticketId}/attachments/{a.id}
 *
 * Este endpoint sirve el binario tras validar JWT + acceso al ticket. El
 * frontend lo consume con fetch + Bearer + blob URL para `<img>`.
 */
export interface AttachmentPayload {
  id: string;
  imageUrl: string | null;
  filePath: string | null;
  storageProvider: string;
  mimeType?: string | null;
  fileSize?: number | null;
}
export function serializeAttachment(
  ticketId: string,
  a: AttachmentPayload
): AttachmentPayload {
  // Cloudinary u otra URL absoluta pública → sin tocar.
  if (a.imageUrl && /^https?:\/\//i.test(a.imageUrl)) {
    return {
      id: a.id,
      imageUrl: a.imageUrl,
      filePath: null,
      storageProvider: a.storageProvider,
      mimeType: a.mimeType,
      fileSize: a.fileSize,
    };
  }
  // Local: reescribimos imageUrl al endpoint autenticado.
  return {
    id: a.id,
    imageUrl: `/api/tickets/${ticketId}/attachments/${a.id}`,
    filePath: a.filePath ?? null,
    storageProvider: a.storageProvider,
    mimeType: a.mimeType,
    fileSize: a.fileSize,
  };
}
