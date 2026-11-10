import { prisma } from "../db/client";

// Formato: TK-YYYYMMDD-NNN  (NNN = correlativo del día, base 1, padded a 3 dígitos)
// Si en un día se generan más de 999 tickets, se rebasará el padding pero seguirá funcionando.
export async function generateTicketNumber(now: Date = new Date()): Promise<string> {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const datePart = `${yyyy}${mm}${dd}`;
  const prefix = `TK-${datePart}-`;

  // Contar tickets ya existentes con el mismo prefijo de fecha.
  const count = await prisma.ticket.count({
    where: { number: { startsWith: prefix } },
  });
  const seq = String(count + 1).padStart(3, "0");
  return `${prefix}${seq}`;
}
