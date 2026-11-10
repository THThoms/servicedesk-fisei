// =============================================================================
// Fase T — Términos de la aceptación digital de soluciones.
//
// Reglas:
//   · Una versión publicada NO se edita nunca. Para cambiar el texto se crea una
//     versión nueva (p. ej. "1.1") y se cambia CURRENT_TERMS_VERSION.
//   · Cada decisión guarda la versión y el SHA-256 del texto: los registros
//     antiguos siguen apuntando al texto exacto que el usuario vio.
//   · Es una CONSTANCIA DE ACEPTACIÓN DIGITAL dentro del sistema. No es una
//     firma electrónica certificada ni se le atribuyen efectos jurídicos que la
//     institución no haya aprobado.
// =============================================================================
import crypto from "crypto";

export interface AcceptanceTermsDef {
  version: string;
  title: string;
  text: string;
}

export const TERMS_V1_0: AcceptanceTermsDef = {
  version: "1.0",
  title: "Constancia de aceptación digital de la solución",
  text: [
    "Al marcar la casilla y confirmar mi decisión dejo constancia, dentro del sistema ServiceDesk de la Facultad de Ingeniería en Sistemas, Electrónica e Industrial (FISEI) de la Universidad Técnica de Ambato, de lo siguiente:",
    "1. He revisado la solución registrada por el personal técnico para este ticket: la descripción del problema, el trabajo realizado, la solución, las imágenes adjuntas disponibles y el historial.",
    "2. Si ACEPTO: confirmo que el servicio reportado fue atendido según la solución descrita y el ticket se cerrará.",
    "3. Si RECHAZO: indico el motivo, el ticket vuelve a atención y el técnico responsable recibe una notificación para continuar el trabajo.",
    "4. Mi decisión queda registrada como constancia de aceptación digital, con mi nombre, correo institucional, fecha y hora, y un código único, y aparecerá en el historial del ticket y en los reportes institucionales del servicio de soporte técnico.",
    "5. Esta constancia no es una firma electrónica certificada; es el registro interno de mi conformidad o disconformidad con la atención recibida.",
  ].join("\n\n"),
};

/** Versión vigente que se presenta al usuario. */
export const CURRENT_TERMS: AcceptanceTermsDef = TERMS_V1_0;
/** Todas las versiones conocidas (las antiguas se conservan para su consulta). */
export const ALL_TERMS: readonly AcceptanceTermsDef[] = [TERMS_V1_0];

export function termsSha256(t: AcceptanceTermsDef): string {
  return crypto.createHash("sha256").update(`${t.version}\n${t.title}\n${t.text}`, "utf8").digest("hex");
}
