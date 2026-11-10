// =============================================================================
// Plantilla de cuentas de prueba para un laboratorio local. Sin datos reales.
//
//   1. Copia este archivo como prisma/seed.demo.ts (ignorado por Git).
//   2. Define DEMO_SEED_PASSWORD con una contraseña propia, que no se reutilice.
//   3. Arranca con SEED_DEMO_USERS=true (nunca se usa con NODE_ENV=production).
//
// Ni esta plantilla ni seed.demo.ts forman parte del paquete de servidor.
// =============================================================================
import { Role } from "../src/domain/enums";

function demoPassword(): string {
  const value = process.env.DEMO_SEED_PASSWORD;
  if (!value) throw new Error("Define DEMO_SEED_PASSWORD para crear las cuentas de prueba.");
  return value;
}

export const seedUsers = [
  { email: "demo.admin@uta.edu.ec", name: "Admin de Prueba", role: Role.admin, password: demoPassword() },
  { email: "demo.tecnico@uta.edu.ec", name: "Técnico de Prueba", role: Role.technician, password: demoPassword() },
  { email: "demo.dtic@uta.edu.ec", name: "DTIC de Prueba", role: Role.dtic, password: demoPassword() },
  { email: "demo.usuario@uta.edu.ec", name: "Usuario de Prueba", role: Role.user, password: demoPassword() },
];

export const microsoftSeedUsers: Array<{ email: string; name: string; role: Role }> = [];
