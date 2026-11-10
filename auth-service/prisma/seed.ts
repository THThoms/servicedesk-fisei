import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import path from "path";
// Sprint B: Role vive en src/domain/enums.ts (Prisma-SQLServer no genera enums).
// El seed corre con ts-node desde `prisma/`; el path relativo cruza a src/.
import { Role } from "../src/domain/enums";

const prisma = new PrismaClient();

// El seed se ejecuta con ts-node en el contenedor de producción, que solo
// incluye `dist/` y `prisma/` (no `src/`). Por eso NO importamos el helper
// de src/utils/passwordSecurity y replicamos aquí el hashing con bcryptjs
// (misma config: 12 salt rounds). El helper sigue siendo la fuente única para
// el código de la aplicación; esta es la única duplicación intencional.
const BCRYPT_ROUNDS = 12;
function hashPassword(password: string): string {
  return bcrypt.hashSync(password, BCRYPT_ROUNDS);
}

// =============================================================================
// HU-13 - NOTA DE SEGURIDAD:
// Las contraseñas de seed.demo.ts son SOLO para entorno de desarrollo local. Son
// credenciales conocidas para facilitar las pruebas del equipo y NO cumplen la
// política de contraseñas seguras (validatePasswordPolicy) a propósito: la
// política se aplica a operaciones vía API (creación / cambio de contraseña),
// no al seed de desarrollo. En producción los usuarios se crean por SSO
// Microsoft (sin contraseña local). Nunca se imprimen estas contraseñas en logs
// y siempre se almacenan hasheadas con bcrypt vía hashPassword().
// =============================================================================
type SeedUser = {
  email: string;
  name: string;
  role: Role;
  password: string;
  legacyEmails?: string[];
};

type MicrosoftSeedUser = {
  email: string;
  name: string;
  role: Role;
};

// Las cuentas demo viven en prisma/seed.demo.ts, que no se incluye en el paquete de
// servidor. Se carga en tiempo de ejecución para que el seed funcione sin ese archivo.
export function loadDemoUsers(
  modulePath: string = path.join(__dirname, "seed.demo")
): { seedUsers: SeedUser[]; microsoftSeedUsers: MicrosoftSeedUser[] } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const m = require(modulePath);
    return { seedUsers: m.seedUsers, microsoftSeedUsers: m.microsoftSeedUsers };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND") return null;
    throw err;
  }
}

// =============================================================================
// Fase P · seguridad — política de siembra de usuarios
//   · Las cuentas DEMO (contraseñas conocidas, documentadas en el README) solo
//     se crean si SEED_DEMO_USERS=true **y** NODE_ENV != production.
//   · En producción el seed NO crea ningún usuario. El administrador inicial
//     se crea con el bootstrap seguro (Fase R):
//       scripts/operations/manage-user.sh bootstrap-admin <correo> "<Nombre>"
//     (contraseña temporal aleatoria, solo hash en BD, cambio obligatorio).
// =============================================================================
const isProduction = (process.env.NODE_ENV ?? "development") === "production";
const seedDemoRequested = (process.env.SEED_DEMO_USERS ?? "false").trim().toLowerCase() === "true";

async function main() {
  if (!seedDemoRequested || isProduction) {
    if (seedDemoRequested && isProduction) {
      console.warn("Seed auth-service: SEED_DEMO_USERS=true IGNORADO porque NODE_ENV=production.");
    }
    console.log("Seed auth-service: producción o sin SEED_DEMO_USERS — no se crean usuarios.");
    return;
  }

  const demo = loadDemoUsers();
  if (!demo) {
    console.warn("Seed auth-service: SEED_DEMO_USERS=true pero prisma/seed.demo.ts no existe (paquete de servidor). No se crean usuarios.");
    return;
  }
  const { seedUsers, microsoftSeedUsers } = demo;

  console.log("Seed auth-service: modo DEMO (SEED_DEMO_USERS=true, NODE_ENV != production).");
  for (const u of seedUsers) {
    let existing = await prisma.user.findUnique({ where: { email: u.email } });

    // Renombra las cuentas artificiales existentes conservando su ID,
    // sesiones y referencias históricas en otros servicios.
    if (!existing && u.legacyEmails?.length) {
      const legacyUser = await prisma.user.findFirst({
        where: { email: { in: u.legacyEmails } },
      });

      if (legacyUser) {
        existing = await prisma.user.update({
          where: { id: legacyUser.id },
          data: {
            email: u.email,
            name: u.name,
            role: u.role,
          },
        });
      }
    }

    // upsert con update solo de nombre/rol; el passwordHash se actualiza solo si
    // el usuario no tenía o tenía un hash legacy (SHA-256 = 64 chars hex, no bcrypt).
    const needsRehash =
      !existing?.passwordHash || !existing.passwordHash.startsWith("$2");

    await prisma.user.upsert({
      where: { email: u.email },
      update: {
        name: u.name,
        role: u.role,
        ...(needsRehash ? { passwordHash: hashPassword(u.password) } : {}),
      },
      create: {
        email: u.email,
        name: u.name,
        role: u.role,
        passwordHash: hashPassword(u.password),
      },
    });
  }

  for (const u of microsoftSeedUsers) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {
        name: u.name,
        role: u.role,
        passwordHash: null,
      },
      create: {
        email: u.email,
        name: u.name,
        role: u.role,
        passwordHash: null,
        microsoftId: null,
      },
    });
  }

  console.log(
    `Seed auth-service: ${seedUsers.length} usuarios locales y ${microsoftSeedUsers.length} usuarios Microsoft listos`
  );
}

if (require.main === module) main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
