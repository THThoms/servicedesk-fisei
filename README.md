# 🎫 ServiceDesk — Mesa de Ayuda HelpDesk

> Sistema de gestión de tickets de soporte técnico con enrutamiento automático por niveles, escalamiento, base de conocimiento y notificaciones por correo.

**Universidad Técnica de Ambato · FISEI**  
Metodología: SCRUM · 3 Sprints · 15 días · 2025

---

## 👥 Equipo

| Rol | Integrante | Responsabilidad principal |
|---|---|---|
| Product Owner | Tomas Solis | Auth, enrutamiento, cierre de ticket |
| Scrum Master | Manolo Garcia | Catálogo de servicios, paneles, notificaciones |
| Developer | Carla Paredes | Base de datos, formulario de ticket, panel admin, pruebas |

---

## 📌 Descripción

El sistema centraliza la atención de soporte técnico institucional. Al crear un ticket, el **servicio seleccionado determina directamente el nivel técnico de entrada** — sin pasar obligatoriamente por todos los niveles. Si el nivel asignado no puede resolver el problema, el técnico lo escala al siguiente y queda registrado en el historial.

### Niveles de atención

| Nivel | Técnicos | Servicios de entrada |
|---|---|---|
| N1 | Técnicos nuevos | Internet, Correo electrónico |
| N2 | Técnico profesional | Equipos, Software |
| N3 | Servidor DITIC | MOODLE, Servicio de calificaciones |
| N4 | Proveedor externo | Fallo crítico de infraestructura |

---

## 🗂️ Estructura del Proyecto

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
├── .gitignore
├── LICENSE
└── README.md
```

---

## 🚀 Ramas — Git Flow

| Rama | Propósito |
|---|---|
| `main` | Versión estable — solo recibe merges de `release/*` |
| `develop` | Integración continua del equipo |
| `feature/HU-XX-descripcion` | Una rama por historia de usuario |
| `release/sprint-N` | Preparación del Sprint Review |
| `hotfix/descripcion` | Correcciones urgentes sobre `main` |

```bash
# Iniciar una historia de usuario
git flow feature start HU-05-enrutamiento

# Terminar y mergear a develop
git flow feature finish HU-05-enrutamiento

# Cerrar un sprint (merge a main + develop + tag)
git flow release start sprint-1
git flow release finish sprint-1
```

---

## 📅 Sprints

### Sprint 1 · Días 1–5
**Objetivo:** Base del sistema — BD, usuarios, catálogo de servicios, formulario de ticket con enrutamiento automático.

| HU | Historia | Responsable |
|---|---|---|
| HU-01 | BD + estructura del proyecto | Carla Paredes |
| HU-02 | Gestión de usuarios y roles | Tomas Solis |
| HU-03 | Catálogo de servicios + reglas de nivel | Manolo Garcia |
| HU-04 | Formulario de ticket (combobox + img) | Carla Paredes |
| HU-05 | Motor de enrutamiento directo al nivel | Tomas Solis |

### Sprint 2 · Días 6–10
**Objetivo:** Gestión completa de tickets — paneles por nivel, escalamiento, historial, base de conocimiento.

| HU | Historia | Responsable |
|---|---|---|
| HU-06 | Panel de bandeja por nivel (N1–N4) | Manolo Garcia |
| HU-07 | Acción: resolver o escalar ticket | Tomas Solis |
| HU-08 | Historial de acciones por nivel | Carla Paredes |
| HU-09 | Consulta de base de conocimiento | Manolo Garcia |

### Sprint 3 · Días 11–15
**Objetivo:** Cierre del ciclo — cierre de ticket, notificación al usuario, panel admin y pruebas finales.

| HU | Historia | Responsable |
|---|---|---|
| HU-10 | Cierre de ticket + llenado de base de conocimiento | Tomas Solis |
| HU-11 | Notificación por correo al usuario (SMTP) | Manolo Garcia |
| HU-12 | Panel de administración general | Carla Paredes |
| HU-13 | Pruebas de integración y correcciones finales | Carla Paredes |

---

## ✅ Definición de Hecho (DoD)

Una historia de usuario se considera completa cuando:

- [ ] El código fue revisado por al menos un compañero (PR aprobado)
- [ ] Cumple los criterios de aceptación definidos en el Sprint Planning
- [ ] Se ejecutaron pruebas unitarias sin errores críticos
- [ ] El módulo fue demostrado y aprobado en el Sprint Review
- [ ] El código está integrado a `develop` sin conflictos

---

## 📄 Licencia

Este proyecto está protegido bajo una **licencia propietaria con permiso de evaluación académica**.  
Se permite la revisión y calificación por parte de docentes de UTA-FISEI.  
Cualquier otro uso requiere autorización escrita de los autores.  
Ver [`LICENSE`](./LICENSE) para más detalles.
