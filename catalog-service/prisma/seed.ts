import { PrismaClient } from "@prisma/client";
// Sprint B: Level / ResponsibleArea viven en src/domain/enums.ts.
import { Level, ResponsibleArea } from "../src/domain/enums";

const prisma = new PrismaClient();

// Cada servicio puede declarar una regla de enrutamiento configurable (HU-06)
// y un área responsable (Sprint 2 rev) que determina qué técnicos pueden atender.
const services: Array<{
  name: string;
  description: string;
  levelEntry: Level;
  responsibleArea: ResponsibleArea;
  priorityHigh?: Level;
  priorityCritical?: Level;
  isCritical?: boolean;
}> = [
  { name: "Red e Internet",           description: "Conectividad de red, WiFi institucional, problemas de acceso a Internet.", levelEntry: Level.N1, responsibleArea: ResponsibleArea.TECHNICIANS, priorityHigh: Level.N2, priorityCritical: Level.N3 },
  { name: "Internet / Conectividad",  description: "Problemas de red, WiFi institucional, VPN.",                                levelEntry: Level.N3, responsibleArea: ResponsibleArea.TECHNICIANS },
  { name: "Correo Electrónico",       description: "Acceso, configuración y problemas con el correo @uta.edu.ec.",              levelEntry: Level.N2, responsibleArea: ResponsibleArea.DTIC },
  { name: "Equipos / Hardware",       description: "Computadoras, impresoras, periféricos.",                                    levelEntry: Level.N1, responsibleArea: ResponsibleArea.TECHNICIANS, priorityHigh: Level.N2 },
  { name: "Software Institucional",   description: "Software académico/administrativo licenciado por UTA.",                     levelEntry: Level.N2, responsibleArea: ResponsibleArea.DTIC },
  { name: "MOODLE",                   description: "Plataforma de aulas virtuales.",                                            levelEntry: Level.N3, responsibleArea: ResponsibleArea.DTIC },
  { name: "Calificaciones (SGA)",     description: "Sistema de Gestión Académica - notas y matrícula.",                          levelEntry: Level.N3, responsibleArea: ResponsibleArea.DTIC },
  { name: "Seguridad de la Información", description: "Incidentes de seguridad, accesos sospechosos, malware.",                 levelEntry: Level.N3, responsibleArea: ResponsibleArea.DTIC, priorityHigh: Level.N3, priorityCritical: Level.N4, isCritical: true },
];

// HU-10 - Artículos iniciales para la base de conocimiento institucional.
// `keywords` se guarda siempre en lowercase para que la búsqueda case-insensitive
// pueda usar `hasSome` directamente con la query también en lowercase.
//
// Sprint 2 (rev) — extendido con cobertura por servicio. La carga es
// idempotente: cada artículo se identifica por (title, serviceId) y se omite
// si ya existe, así que correr el seed varias veces NO duplica.
const knowledgeArticles: Array<{
  title: string;
  problemDescription: string;
  solution: string;
  keywords: string[];
  serviceName?: string;
}> = [
  // --- Servicio: Red e Internet / Internet / Conectividad (WiFi y red) ---
  {
    title: "Error de conexión VPN institucional",
    problemDescription:
      "El usuario reporta que no puede establecer conexión con la VPN institucional para acceder a recursos internos de la UTA desde fuera del campus.",
    solution:
      "1) Verificar que el usuario tenga credenciales institucionales activas. " +
      "2) Confirmar conexión a internet desde el equipo. " +
      "3) Reinstalar o reconfigurar el cliente VPN siguiendo la guía oficial. " +
      "4) Si el problema persiste, escalar al área de redes con captura del log de conexión.",
    keywords: ["vpn", "conexion", "acceso remoto", "credenciales", "red"],
    serviceName: "Red e Internet",
  },
  {
    title: "WiFi institucional intermitente en aulas",
    problemDescription:
      "Los docentes y estudiantes reportan caídas frecuentes del WiFi institucional en bloques específicos del campus, afectando clases y consultas al SGA.",
    solution:
      "1) Verificar saturación del punto de acceso más cercano. " +
      "2) Solicitar reinicio remoto del AP al equipo de redes. " +
      "3) Si el problema afecta a un bloque completo, reportar al área de redes para inspección física del switch.",
    keywords: ["wifi", "red", "conectividad", "aulas", "punto de acceso"],
    serviceName: "Red e Internet",
  },
  {
    title: "Problemas de conexión a la red WiFi institucional",
    problemDescription:
      "El usuario no puede conectarse a la red inalámbrica institucional o la conexión se interrumpe constantemente.",
    solution:
      "Verificar que el adaptador inalámbrico esté activo, olvidar la red guardada, volver a ingresar las credenciales institucionales, reiniciar el adaptador de red y comprobar la cobertura del punto de acceso más cercano. Si el problema afecta a varios usuarios en la misma zona, registrar el área y derivar para revisión de infraestructura.",
    keywords: ["wifi", "red", "conexion", "inalambrico", "internet", "credenciales", "cobertura"],
    serviceName: "Red e Internet",
  },
  {
    title: "Señal WiFi débil en aulas o laboratorios",
    problemDescription:
      "El usuario reporta baja intensidad de señal, navegación lenta o desconexiones frecuentes en un espacio institucional.",
    solution:
      "Validar la ubicación del usuario, comprobar si otros dispositivos presentan el mismo problema, reiniciar el equipo cliente, verificar saturación del punto de acceso y registrar el bloque o laboratorio afectado para revisión técnica.",
    keywords: ["wifi", "senal", "lentitud", "aula", "laboratorio", "cobertura", "desconexion"],
    serviceName: "Red e Internet",
  },
  {
    title: "Sin acceso a Internet en equipo institucional",
    problemDescription:
      "El equipo tiene conexión física o inalámbrica, pero no puede navegar en Internet.",
    solution:
      "Verificar conexión de red, revisar dirección IP asignada, comprobar puerta de enlace, probar navegación en otro sitio, reiniciar adaptador de red y validar si el problema afecta a otros equipos del mismo sector.",
    keywords: ["internet", "red", "conexion", "ip", "navegacion", "gateway"],
    serviceName: "Internet / Conectividad",
  },
  {
    title: "Conectividad intermitente en red institucional",
    problemDescription:
      "El usuario reporta cortes frecuentes de conexión durante el uso de servicios institucionales.",
    solution:
      "Revisar cableado o conexión inalámbrica, validar estabilidad de red, comprobar si hay pérdida de paquetes y registrar hora, ubicación y servicio afectado para análisis posterior.",
    keywords: ["red", "intermitencia", "cortes", "conectividad", "paquetes", "servicio"],
    serviceName: "Internet / Conectividad",
  },

  // --- Servicio: Equipos / Hardware (hardware, impresoras, laboratorios, equipos, proyectores) ---
  {
    title: "Impresora institucional no responde",
    problemDescription:
      "Una impresora compartida deja de responder a los trabajos enviados desde varios equipos de la facultad.",
    solution:
      "1) Verificar conexión eléctrica y de red de la impresora. " +
      "2) Reiniciar el dispositivo y la cola de impresión local. " +
      "3) Limpiar trabajos atascados en el spooler. " +
      "4) Reinstalar el driver desde el portal de soporte si persiste.",
    keywords: ["impresora", "hardware", "spooler", "driver"],
    serviceName: "Equipos / Hardware",
  },
  {
    title: "Equipo de cómputo no enciende",
    problemDescription: "El equipo no responde al presionar el botón de encendido.",
    solution:
      "Verificar cable de poder, regulador, tomacorriente, fuente de energía e indicadores luminosos. Probar con otro cable si es posible y registrar el equipo para revisión física si no presenta señales de energía.",
    keywords: ["hardware", "equipo", "computadora", "energia", "encendido", "fuente"],
    serviceName: "Equipos / Hardware",
  },
  {
    title: "Teclado o mouse no responde",
    problemDescription:
      "El teclado o mouse conectado al equipo no funciona correctamente.",
    solution:
      "Revisar conexión USB, probar otro puerto, reiniciar el equipo, validar el periférico en otro computador y reemplazarlo si se confirma daño físico.",
    keywords: ["hardware", "teclado", "mouse", "periferico", "usb", "dispositivo"],
    serviceName: "Equipos / Hardware",
  },
  {
    title: "Impresora no responde al enviar documentos",
    problemDescription:
      "El usuario envía documentos a imprimir, pero la impresora no ejecuta el trabajo.",
    solution:
      "Verificar que la impresora esté encendida, conectada a red o USB, revisar cola de impresión, comprobar papel y tóner, reiniciar el servicio de impresión y volver a enviar el documento.",
    keywords: ["impresora", "impresion", "cola", "toner", "papel", "documento"],
    serviceName: "Equipos / Hardware",
  },
  {
    title: "Documento queda atascado en la cola de impresión",
    problemDescription:
      "Los documentos enviados permanecen pendientes y no se imprimen.",
    solution:
      "Cancelar trabajos detenidos, reiniciar la cola de impresión, validar conexión de la impresora y enviar una página de prueba.",
    keywords: ["impresora", "cola", "impresion", "atasco", "documento", "prueba"],
    serviceName: "Equipos / Hardware",
  },
  {
    title: "Equipo de laboratorio sin acceso al sistema",
    problemDescription:
      "Un equipo de laboratorio no permite ingresar o usar servicios institucionales.",
    solution:
      "Verificar red, sesión de usuario, estado del equipo, disponibilidad del sistema y registrar número o ubicación del equipo afectado.",
    keywords: ["laboratorio", "equipo", "acceso", "sistema", "red", "aula"],
    serviceName: "Equipos / Hardware",
  },
  {
    title: "Falla general en laboratorio de cómputo",
    problemDescription:
      "Varios equipos del laboratorio presentan fallas similares.",
    solution:
      "Identificar si la falla es eléctrica, de red o software, registrar cantidad de equipos afectados y priorizar revisión técnica del ambiente.",
    keywords: ["laboratorio", "falla", "equipos", "red", "software", "aula"],
    serviceName: "Equipos / Hardware",
  },
  {
    title: "Proyector no muestra imagen",
    problemDescription:
      "El proyector está encendido, pero no muestra la imagen del equipo conectado.",
    solution:
      "Verificar cable HDMI o VGA, seleccionar fuente correcta, probar duplicar pantalla desde el equipo, revisar adaptador y reiniciar el proyector si es necesario.",
    keywords: ["proyector", "imagen", "hdmi", "vga", "pantalla", "aula"],
    serviceName: "Equipos / Hardware",
  },
  {
    title: "Imagen del proyector se ve borrosa o distorsionada",
    problemDescription:
      "La proyección aparece desenfocada, cortada o con mala calidad.",
    solution:
      "Ajustar enfoque, revisar resolución del equipo, verificar cable de video, limpiar lente externamente y reportar si persiste.",
    keywords: ["proyector", "imagen", "enfoque", "resolucion", "lente", "video"],
    serviceName: "Equipos / Hardware",
  },

  // --- Servicio: Software Institucional ---
  {
    title: "Aplicación institucional no abre correctamente",
    problemDescription:
      "El usuario intenta abrir una aplicación instalada y esta no inicia o muestra errores.",
    solution:
      "Reiniciar el equipo, verificar permisos del usuario, comprobar instalación de dependencias, ejecutar la aplicación como usuario autorizado y registrar el mensaje de error exacto para soporte.",
    keywords: ["software", "aplicacion", "error", "instalacion", "permisos", "sistema"],
    serviceName: "Software Institucional",
  },
  {
    title: "Programa funciona lento o se bloquea",
    problemDescription:
      "Una aplicación se congela, responde lentamente o se cierra inesperadamente.",
    solution:
      "Cerrar procesos innecesarios, revisar consumo de memoria, reiniciar la aplicación, actualizar si existe una versión institucional autorizada y reportar si el problema persiste.",
    keywords: ["software", "lentitud", "bloqueo", "programa", "rendimiento", "actualizacion"],
    serviceName: "Software Institucional",
  },

  // --- Servicio: MOODLE (plataformas institucionales) ---
  {
    title: "No se puede acceder a plataforma institucional",
    problemDescription:
      "El usuario no puede ingresar a una plataforma académica o administrativa.",
    solution:
      "Verificar usuario y contraseña, comprobar conexión a Internet, limpiar caché del navegador, probar en modo incógnito y validar si el perfil del usuario tiene acceso habilitado.",
    keywords: ["plataforma", "acceso", "login", "credenciales", "navegador", "cache"],
    serviceName: "MOODLE",
  },
  {
    title: "Módulos de plataforma no cargan correctamente",
    problemDescription:
      "La plataforma abre, pero algunos módulos no se muestran o cargan con errores.",
    solution:
      "Actualizar el navegador, limpiar caché, revisar permisos del usuario, probar otro navegador y registrar captura del error para soporte.",
    keywords: ["plataforma", "modulo", "error", "navegador", "permisos", "carga"],
    serviceName: "MOODLE",
  },

  // --- Servicio: Calificaciones (SGA) / Sistema Integrado (sistemas académicos) ---
  {
    title: "Error al ingresar al sistema académico",
    problemDescription:
      "El usuario no puede iniciar sesión en el sistema académico institucional.",
    solution:
      "Validar credenciales, revisar estado de la cuenta, confirmar rol asignado, limpiar caché del navegador y verificar si existe mantenimiento programado.",
    keywords: ["academico", "sistema", "acceso", "login", "cuenta", "estudiante", "docente"],
    serviceName: "Calificaciones (SGA)",
  },
  {
    title: "Información académica no se muestra correctamente",
    problemDescription:
      "El usuario indica que sus datos, cursos o registros académicos no aparecen correctamente.",
    solution:
      "Verificar periodo académico activo, revisar permisos del perfil, actualizar la sesión y derivar a revisión administrativa si los datos no corresponden.",
    keywords: ["academico", "cursos", "datos", "periodo", "perfil", "registros"],
    serviceName: "Calificaciones (SGA)",
  },
  {
    title: "Error al ingresar al sistema integrado",
    problemDescription:
      "El usuario no puede iniciar sesión en el sistema integrado institucional.",
    solution:
      "Validar credenciales, comprobar estado del servicio, verificar rol del usuario y limpiar caché del navegador. Registrar el módulo afectado y la hora del intento.",
    keywords: ["sistema", "integrado", "acceso", "login", "modulo", "credenciales"],
    serviceName: "Sistema Integrado",
  },
  {
    title: "Módulo del sistema integrado no responde",
    problemDescription:
      "Un módulo del sistema integrado deja de responder o devuelve errores al consultar información.",
    solution:
      "Identificar el módulo, capturar el mensaje de error, revisar el estado del servicio, intentar nuevamente en otro navegador y registrar el incidente para soporte.",
    keywords: ["sistema", "integrado", "modulo", "error", "consulta", "servicio"],
    serviceName: "Sistema Integrado",
  },

  // --- Servicio: Correo Electrónico ---
  {
    title: "No llegan correos institucionales",
    problemDescription:
      "El usuario no recibe mensajes en su cuenta institucional.",
    solution:
      "Revisar carpeta de spam, comprobar espacio disponible, validar filtros configurados, verificar conexión y confirmar si el remitente recibió mensaje de rebote.",
    keywords: ["correo", "email", "institucional", "spam", "bandeja", "mensajes"],
    serviceName: "Correo Electrónico",
  },
  {
    title: "No se puede enviar correo institucional",
    problemDescription:
      "El usuario puede ingresar a su correo, pero no logra enviar mensajes.",
    solution:
      "Verificar conexión, revisar tamaño de archivos adjuntos, comprobar destinatarios, validar límites de envío y probar desde otro navegador.",
    keywords: ["correo", "envio", "email", "adjunto", "destinatario", "institucional"],
    serviceName: "Correo Electrónico",
  },

  // --- Servicio: Seguridad de la Información (accesos + seguridad informática) ---
  {
    title: "Credenciales institucionales rechazadas",
    problemDescription:
      "El usuario intenta ingresar a un servicio institucional y sus credenciales no son aceptadas.",
    solution:
      "Confirmar que el usuario esté escribiendo correctamente sus credenciales, validar estado de la cuenta, solicitar restablecimiento de contraseña si aplica y verificar permisos del servicio.",
    keywords: ["acceso", "credenciales", "cuenta", "contrasena", "permisos", "usuario"],
    serviceName: "Seguridad de la Información",
  },
  {
    title: "Cuenta institucional bloqueada",
    problemDescription:
      "El usuario no puede ingresar porque su cuenta aparece bloqueada o restringida.",
    solution:
      "Verificar intentos fallidos, confirmar identidad del usuario por los canales institucionales, solicitar desbloqueo al área correspondiente y registrar el caso.",
    keywords: ["cuenta", "bloqueo", "acceso", "credenciales", "desbloqueo", "seguridad"],
    serviceName: "Seguridad de la Información",
  },
  {
    title: "Sospecha de correo fraudulento",
    problemDescription:
      "El usuario recibe un correo sospechoso que solicita datos personales o credenciales.",
    solution:
      "No abrir enlaces ni descargar adjuntos, conservar el mensaje, reportarlo al área correspondiente y recomendar cambio de contraseña si el usuario ingresó información.",
    keywords: ["seguridad", "phishing", "correo", "fraude", "credenciales", "amenaza"],
    serviceName: "Seguridad de la Información",
  },
  {
    title: "Equipo con posible malware",
    problemDescription:
      "El equipo muestra comportamiento anormal, ventanas emergentes o lentitud extrema.",
    solution:
      "Desconectar temporalmente de la red si es necesario, no ingresar credenciales, ejecutar revisión autorizada y registrar los síntomas observados.",
    keywords: ["seguridad", "malware", "virus", "equipo", "amenaza", "revision"],
    serviceName: "Seguridad de la Información",
  },
];

// Sprint 3+ — Catálogo oficial de ubicaciones físicas de la FISEI donde
// pueden originarse tickets. Idempotente: se upsertea por `name` único.
// El listado (23) proviene del área académica de la facultad; edición y
// altas nuevas quedan disponibles vía panel admin (/api/catalog/locations).
const officialLocations: string[] = [
  "Laboratorio 1",
  "Laboratorio 2",
  "Laboratorio 3",
  "Laboratorio 4",
  "Laboratorio 5",
  "Laboratorio 6",
  "Laboratorio 7",
  "Laboratorio 8",
  "Laboratorio de Robótica y Redes Industriales",
  "Laboratorio CTT - FISEI (Centro de Transferencia de Tecnología)",
  "Laboratorio CADME (Centro de Apoyo al Desarrollo Metal Mecánico)",
  "Laboratorio de Instrumentación Industrial",
  "Laboratorio de Electrónica y Telecomunicaciones",
  "Laboratorio de Mecanismos",
  "Decanato y Subdecanato",
  "Secretaría de la Facultad",
  "Coordinaciones de Carrera (Software, Telecomunicaciones, Industrial, Robótica/Mecatrónica)",
  "Unidad de Titulación y Prácticas Preprofesionales",
  "Sala de Profesores",
  "Biblioteca de la FISEI",
  "Auditorio de la Facultad",
  "Unidad de Investigación Operativa (FISEI)",
  "Salas Audiovisuales",
];

async function main() {
  for (const s of services) {
    const ruleData = {
      levelEntry: s.levelEntry,
      priorityHigh: s.priorityHigh ?? null,
      priorityCritical: s.priorityCritical ?? null,
      isCritical: s.isCritical ?? false,
    };
    await prisma.service.upsert({
      where: { name: s.name },
      update: {
        description: s.description,
        levelEntry: s.levelEntry,
        responsibleArea: s.responsibleArea,
        isActive: true,
        routingRule: { upsert: { create: ruleData, update: ruleData } },
      },
      create: {
        name: s.name,
        description: s.description,
        levelEntry: s.levelEntry,
        responsibleArea: s.responsibleArea,
        routingRule: { create: ruleData },
      },
    });
  }
  console.log(`Seed catalog-service: ${services.length} servicios cargados`);

  // HU-10 / Sprint 2 (rev) - Carga idempotente de artículos.
  // Para cada entrada del catálogo de seed:
  //   1) Resolvemos el servicio por nombre exacto (si la entrada lo declara).
  //   2) Buscamos un artículo existente por (title, serviceId).
  //   3) Si existe, lo respetamos tal cual (puede haber sido editado por un
  //      técnico) y lo saltamos. Si no existe, lo creamos.
  // Resultado: ejecutar el seed N veces no duplica artículos ni pisa los
  // creados manualmente desde la UI.
  let created = 0;
  let skipped = 0;
  let missingService = 0;
  for (const k of knowledgeArticles) {
    const service = k.serviceName
      ? await prisma.service.findUnique({ where: { name: k.serviceName } })
      : null;
    if (k.serviceName && !service) {
      // Servicio del catálogo de seed no presente en BD: omitimos en silencio
      // para no fallar instalaciones con menos servicios.
      missingService++;
      console.warn(
        `Seed knowledge: servicio "${k.serviceName}" no existe en BD; se omite "${k.title}"`
      );
      continue;
    }
    const existing = await prisma.knowledgeArticle.findFirst({
      where: { title: k.title, serviceId: service?.id ?? null },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }
    // Sprint B: keywords viven en tabla puente 1:N. Normalizadas a lowercase
    // y deduplicadas antes de nested-create.
    const normalizedKeywords = Array.from(
      new Set(k.keywords.map((s) => s.toLowerCase()))
    );
    await prisma.knowledgeArticle.create({
      data: {
        title: k.title,
        problemDescription: k.problemDescription,
        solution: k.solution,
        serviceId: service?.id ?? null,
        keywords: {
          create: normalizedKeywords.map((kw) => ({ keyword: kw })),
        },
      },
    });
    created++;
  }
  console.log(
    `Seed knowledge: ${created} creados, ${skipped} ya existían (omitidos), ${missingService} sin servicio (omitidos).`
  );

  // Sprint 3+ — Ubicaciones oficiales de la FISEI (idempotente por `name`).
  // Un `upsert` con `update: {}` respeta cambios manuales del admin (renombre,
  // desactivación) y solo crea las que no existen; ejecutar el seed N veces
  // no genera duplicados ni pisa el estado de la BD.
  let locationsCreated = 0;
  for (const name of officialLocations) {
    const existing = await prisma.location.findUnique({ where: { name } });
    if (!existing) {
      await prisma.location.create({ data: { name } });
      locationsCreated++;
    }
  }
  console.log(
    `Seed locations: ${locationsCreated} creadas, ${officialLocations.length - locationsCreated} ya existían.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
