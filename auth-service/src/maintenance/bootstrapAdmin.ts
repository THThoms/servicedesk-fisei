// =============================================================================
// Fase R — Bootstrap seguro del administrador inicial / reset de contraseña.
//
//   node dist/maintenance/bootstrapAdmin.js create --email <correo> [--name "<Nombre>"] [--sso-only]
//   node dist/maintenance/bootstrapAdmin.js reset  --email <correo>
//
// create: SOLO si no existe ningún administrador (no crea un segundo admin
//         automáticamente → exit 3). Genera una contraseña TEMPORAL aleatoria,
//         guarda únicamente su hash bcrypt y marca mustChangePassword=true: el
//         primer login solo permite cambiarla. --sso-only crea la cuenta sin
//         contraseña local (entrará por Microsoft).
// reset:  nueva contraseña temporal para una cuenta existente, revoca sus
//         sesiones y exige cambio (recuperación de acceso).
//
// Salida: la contraseña temporal se escribe UNA vez en stdout (una línea) y
// nada más va a stdout; los mensajes van a stderr. El llamador
// (scripts/operations/manage-user.sh) la guarda en un archivo 0600 y nunca la
// muestra en pantalla ni en logs. No se guarda en variables de entorno.
// Códigos: 0 ok · 2 argumentos · 3 ya existe admin · 4 cuenta existente/inexistente.
// =============================================================================
import crypto from "crypto";
import { prisma } from "../db/client";
import { Role } from "../domain/enums";
import { hashPassword } from "../utils/passwordSecurity";
import { revokeAllSessions } from "../services/authService";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

/** ≥20 caracteres con mayúscula, minúscula, dígito y símbolo, sin caracteres ambiguos. */
export function generateTemporaryPassword(): string {
  const pick = (set: string) => set[crypto.randomInt(set.length)];
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnpqrstuvwxyz";
  const digit = "23456789";
  const sym = "-_.";
  const all = upper + lower + digit + sym;
  const chars = [pick(upper), pick(lower), pick(digit), pick(sym)];
  while (chars.length < 22) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

async function main(): Promise<number> {
  const mode = process.argv[2];
  const email = (arg("email") ?? "").trim().toLowerCase();
  const domain = (process.env.ALLOWED_DOMAIN ?? "uta.edu.ec").toLowerCase();
  if (!["create", "reset"].includes(mode) || !email) {
    console.error("Uso: bootstrapAdmin.js create|reset --email <correo> [--name <Nombre>] [--sso-only]");
    return 2;
  }
  if (!email.endsWith(`@${domain}`)) {
    console.error(`El correo debe pertenecer a @${domain}`);
    return 2;
  }

  if (mode === "create") {
    const admins = await prisma.user.count({ where: { role: Role.admin } });
    if (admins > 0) {
      console.error("Ya existe al menos un administrador: el bootstrap no crea otro. Usa 'manage-user.sh set-role'.");
      return 3;
    }
    if (await prisma.user.findUnique({ where: { email } })) {
      console.error("La cuenta ya existe: usa 'manage-user.sh set-role <correo> admin'.");
      return 4;
    }
    const ssoOnly = process.argv.includes("--sso-only");
    const temp = ssoOnly ? "" : generateTemporaryPassword();
    await prisma.user.create({
      data: {
        email,
        name: (arg("name") ?? "Administrador ServiceDesk").trim(),
        role: Role.admin,
        passwordHash: temp ? hashPassword(temp) : null,
        mustChangePassword: !ssoOnly,
      },
    });
    console.error(`Administrador inicial creado (${ssoOnly ? "solo SSO" : "contraseña temporal, cambio obligatorio"}).`);
    if (temp) process.stdout.write(temp + "\n");
    return 0;
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error("La cuenta no existe.");
    return 4;
  }
  const temp = generateTemporaryPassword();
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: hashPassword(temp), mustChangePassword: true },
  });
  await revokeAllSessions(user.id);
  console.error("Contraseña temporal generada; sesiones previas revocadas; cambio obligatorio en el próximo login.");
  process.stdout.write(temp + "\n");
  return 0;
}

if (require.main === module) {
  main()
    .then((code) => (process.exitCode = code))
    .catch((e) => {
      console.error("ERROR:", e instanceof Error ? e.message : e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
