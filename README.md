# ServiceDesk — Mesa de Ayuda HelpDesk

> Sistema de gestión de tickets de soporte técnico con enrutamiento automático por niveles, escalamiento, base de conocimiento y notificaciones.

**Universidad Técnica de Ambato · FISEI** | Metodología: SCRUM · 3 Sprints · 2025

---

## Equipo

| Rol | Integrante | Responsabilidad principal |
|---|---|---|
| Product Owner | Tomas Solis | Auth, enrutamiento, cierre de ticket |
| Scrum Master | Manolo Garcia | Catálogo de servicios, paneles, notificaciones |
| Developer | Carla Paredes | Base de datos, formulario de ticket, panel admin, pruebas |

---

## Documentación principal

Todo el detalle del proyecto se encuentra en el documento SCRUM:

**[SCRUM_ServiceDesk_v2.docx](./SCRUM_ServiceDesk_v2.docx)**

Contenido del documento:

- Product Backlog completo (HU-01 a HU-13) con puntos de historia y responsables
- Planificación de Sprint 1, 2 y 3 (objetivos, criterios de aceptación por HU)
- Arquitectura del sistema y esquema de base de datos
- Flujos de comunicacion entre servicios
- Definicion de Hecho (DoD)

---

## Estructura del proyecto

```
servicedesk-fisei/
├── src/
│   ├── auth/           # HU-02 · Autenticación y roles
│   ├── tickets/        # HU-04, HU-05 · Formulario y enrutamiento
│   ├── technician/     # HU-06, HU-07, HU-08 · Paneles y escalamiento
│   ├── knowledge/      # HU-09, HU-10 · Base de conocimiento
│   ├── notifications/  # HU-11 · Notificaciones SMTP
│   └── admin/          # HU-12 · Panel de administración
├── db/
│   └── schema.sql      # HU-01 · Scripts de base de datos
├── docs/               # Documentación del proyecto
├── tests/              # HU-13 · Pruebas de integración
├── docker-compose.yml
├── .env.example
├── LICENSE
└── README.md
```

---

## Ramas — Git Flow

| Rama | Propósito |
|---|---|
| `main` | Versión estable — solo recibe merges de `release/*` |
| `develop` | Integración continua del equipo |
| `feature/HU-XX-descripcion` | Una rama por historia de usuario |
| `release/sprint-N` | Preparación del Sprint Review |
| `hotfix/descripcion` | Correcciones urgentes sobre `main` |

```bash
# Iniciar una historia de usuario
git flow feature start HU-02-autenticacion-roles

# Terminar y mergear a develop
git flow feature finish HU-02-autenticacion-roles

# Cerrar un sprint (merge a main + develop + tag)
git flow release start sprint-1
git flow release finish sprint-1
```

---

## Cómo arrancar

**Requisitos:** Docker, Docker Compose, Node.js 18+

```bash
# 1. Clonar el repositorio
git clone <url-del-repo>
cd servicedesk-fisei

# 2. Configurar variables de entorno
cp .env.example .env

# 3. Levantar la base de datos
docker-compose up -d db

# 4. Instalar dependencias y arrancar la app
npm install
npm run dev
```

---

## Licencia

Licencia propietaria con permiso de evaluación académica.
Se permite la revisión y calificación por docentes de UTA-FISEI.
Ver [`LICENSE`](./LICENSE) para más detalles.
