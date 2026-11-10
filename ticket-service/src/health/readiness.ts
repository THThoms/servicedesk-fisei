// Fase T — readiness real para el healthcheck de Docker: no basta con que el
// proceso responda (eso es /health, liveness); comprueba la base de datos con
// una consulta real y límite de tiempo. La respuesta no revela detalles internos.
import { prisma } from "../db/client";

export async function checkDatabase(timeoutMs = 3000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
        timer.unref?.();
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** El volumen de imágenes debe existir y admitir escritura. */
export async function checkUploadsWritable(dir: string): Promise<boolean> {
  const fs = await import("fs/promises");
  try {
    await fs.access(dir, (await import("fs")).constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
