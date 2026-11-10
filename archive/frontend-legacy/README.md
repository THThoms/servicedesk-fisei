# Frontend heredado — modelo por NIVEL (N1–N4) — NO USAR

Páginas retiradas en la Fase R (2026-11). No estaban enrutadas en `App.tsx`
desde el Sprint 2 (rev) y consumían endpoints que ahora responden **410 Gone**
(`GET /api/tickets/level`, `PUT /api/tickets/escalate`, `PATCH /api/tickets/:id/status`).

| Archivo | Sustituido por |
|---|---|
| `PanelTecnico.tsx` | `frontend/src/pages/PanelTecnicoV2.tsx` (por área) |
| `BandejaTickets.tsx` | `PanelTecnicoV2.tsx` + `MisTicketsAceptados.tsx` |

Se conservan solo como referencia histórica; no se compilan ni se empaquetan.
