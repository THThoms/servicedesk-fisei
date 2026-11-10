// Sprint 3+ — Layout institucional (header + navegación + footer).
//
// Rediseño completo del encabezado:
//   Zona 1 · header institucional compacto (bg azul UTA) con branding + usuario.
//   Zona 2 · navbar blanca con sombra sutil, estado activo azul suave + borde inferior.
//   Responsive: en <lg el menú se colapsa en un botón hamburguesa que abre un
//               drawer vertical (mismo listado, respetando la lógica por rol).
//
// Reglas respetadas:
//   - No se cambia lógica, rutas ni permisos.
//   - Se conservan las dos entradas de conocimiento (rutas distintas):
//       /conocimiento         → "Conocimiento"  (staff/tech, solo lectura)
//       /admin/conocimiento   → "Gestionar KB"  (admin, CRUD)
//   - Sin dependencias nuevas: iconos SVG inline (estilo Lucide).

import { ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { api } from "../lib/api";
import { clearToken, getCurrentUser, isStaffRole, Role, roleLabel } from "../lib/auth";
import { unregisterPushToken } from "../lib/pushNotifications";
import { getAccountNameLabel } from "../lib/technician";

interface LayoutProps {
  children: ReactNode;
  /** Mostrar la navegación (oculta en /login). */
  showSubnav?: boolean;
}

function getRoleLabel(role: string): string {
  return roleLabel(role);
}

function getInitials(name: string | undefined | null): string {
  if (!name) return "U";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join("") || "U";
}

// ---------------------------------------------------------------------------
// Iconos SVG inline (16×16, currentColor). Se copian de Lucide para mantener
// el mismo grosor de trazo (1.75) y no introducir dependencias nuevas.
// ---------------------------------------------------------------------------
type IconProps = { className?: string };
const iconBase = "h-4 w-4 shrink-0";
const stroke: React.SVGProps<SVGSVGElement> = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  viewBox: "0 0 24 24",
  "aria-hidden": true,
};

const IconPlus = ({ className = iconBase }: IconProps) => (
  <svg {...stroke} className={className}><path d="M12 5v14M5 12h14" /></svg>
);
const IconTicket = ({ className = iconBase }: IconProps) => (
  <svg {...stroke} className={className}>
    <path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8z" />
    <path d="M13 6v12" />
  </svg>
);
const IconSupport = ({ className = iconBase }: IconProps) => (
  <svg {...stroke} className={className}>
    <path d="M18 20a2 2 0 0 0 2-2v-4a8 8 0 1 0-16 0v4a2 2 0 0 0 2 2h1v-6H4" />
    <path d="M20 14h-1v6h-1" />
  </svg>
);
const IconCheckList = ({ className = iconBase }: IconProps) => (
  <svg {...stroke} className={className}>
    <path d="M9 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3" />
    <path d="M9 3h6v4H9z" />
    <path d="m9 14 2 2 4-4" />
  </svg>
);
const IconBook = ({ className = iconBase }: IconProps) => (
  <svg {...stroke} className={className}>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);
const IconChart = ({ className = iconBase }: IconProps) => (
  <svg {...stroke} className={className}>
    <path d="M3 3v18h18" />
    <path d="M7 15v-4M12 15V9M17 15v-2" />
  </svg>
);
const IconHistory = ({ className = iconBase }: IconProps) => (
  <svg {...stroke} className={className}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7v5l3 2" />
  </svg>
);
const IconReport = ({ className = iconBase }: IconProps) => (
  <svg {...stroke} className={className}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
    <path d="M8 13h8M8 17h5" />
  </svg>
);
const IconCatalog = ({ className = iconBase }: IconProps) => (
  <svg {...stroke} className={className}>
    <path d="M3 4h18v4H3zM3 10h18v4H3zM3 16h18v4H3z" />
  </svg>
);
const IconSettings = ({ className = iconBase }: IconProps) => (
  <svg {...stroke} className={className}>
    <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);
const IconPin = ({ className = iconBase }: IconProps) => (
  <svg {...stroke} className={className}>
    <path d="M12 22s7-5.5 7-12a7 7 0 1 0-14 0c0 6.5 7 12 7 12z" />
    <circle cx="12" cy="10" r="2.5" />
  </svg>
);
const IconLogout = ({ className = iconBase }: IconProps) => (
  <svg {...stroke} className={className}>
    <path d="M15 12H3M9 6l-6 6 6 6" />
    <path d="M15 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
  </svg>
);
const IconMenu = ({ className = iconBase }: IconProps) => (
  <svg {...stroke} className={className}><path d="M4 6h16M4 12h16M4 18h16" /></svg>
);
const IconClose = ({ className = iconBase }: IconProps) => (
  <svg {...stroke} className={className}><path d="M18 6 6 18M6 6l12 12" /></svg>
);

// ---------------------------------------------------------------------------
// Ítems de navegación. `visibility` decide en qué rol se renderiza cada uno.
// Las rutas coinciden EXACTAMENTE con las registradas en App.tsx.
// ---------------------------------------------------------------------------
type Visibility = "all" | "staff" | "admin";
interface NavItem {
  to: string;
  label: string;
  visibility: Visibility;
  Icon: (p: IconProps) => JSX.Element;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/tickets/nuevo",         label: "Crear ticket",   visibility: "all",   Icon: IconPlus },
  { to: "/mis-tickets",           label: "Mis Tickets",    visibility: "all",   Icon: IconTicket },
  { to: "/panel",                 label: "Panel Técnico",  visibility: "staff", Icon: IconSupport },
  { to: "/mis-aceptados",         label: "Mis Aceptados",  visibility: "staff", Icon: IconCheckList },
  // /conocimiento = base de conocimiento en modo consulta (staff/tech).
  { to: "/conocimiento",          label: "Conocimiento",   visibility: "staff", Icon: IconBook },
  { to: "/admin/stats",           label: "Estadísticas",   visibility: "admin", Icon: IconChart },
  { to: "/admin/historial",       label: "Historial",      visibility: "admin", Icon: IconHistory },
  { to: "/admin/reportes",        label: "Reportes",       visibility: "admin", Icon: IconReport },
  { to: "/admin/bloques",         label: "Bloques",        visibility: "admin", Icon: IconReport },
  { to: "/admin/catalogo",        label: "Catálogo",       visibility: "admin", Icon: IconCatalog },
  // /admin/conocimiento = CRUD admin de la misma base. Rótulo distinto para
  // no confundir visualmente con la entrada de consulta de arriba.
  { to: "/admin/conocimiento",    label: "Gestionar KB",   visibility: "admin", Icon: IconSettings },
  { to: "/admin/ubicaciones",     label: "Ubicaciones",    visibility: "admin", Icon: IconPin },
];

function itemsForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => {
    if (item.visibility === "all") return true;
    if (item.visibility === "staff") return isStaffRole(role);
    if (item.visibility === "admin") return role === "admin";
    return false;
  });
}

/**
 * Coincidencia activa por prefijo, pero desambiguando entre rutas que se
 * solapan (p. ej. /admin/conocimiento vs /conocimiento). Elegimos el ítem cuya
 * ruta sea la coincidencia MÁS LARGA con el pathname actual.
 */
function activePathFor(pathname: string, items: NavItem[]): string | null {
  let best: string | null = null;
  for (const item of items) {
    if (pathname === item.to || pathname.startsWith(item.to + "/")) {
      if (!best || item.to.length > best.length) best = item.to;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
export function Layout({ children, showSubnav = true }: LayoutProps) {
  const user = getCurrentUser();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // Cerrar el drawer / menú al navegar.
  useEffect(() => {
    setMobileOpen(false);
    setUserMenuOpen(false);
  }, [location.pathname]);

  // Cerrar el drawer con Esc.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  async function logout() {
    // Sprint 4+ · Dar de baja el token FCM del dispositivo actual (Android).
    // No bloquea el logout si falla o si no aplica (web).
    await unregisterPushToken().catch(() => undefined);
    try {
      await api.post("/api/auth/logout");
    } catch {
      // ignoramos: la sesión se limpia localmente igual.
    }
    clearToken();
    navigate("/login");
  }

  const items = useMemo(() => (user ? itemsForRole(user.role) : []), [user]);
  const activeTo = useMemo(() => activePathFor(location.pathname, items), [location.pathname, items]);
  const showNav = showSubnav && user;

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden">
      {/* =====================================================================
          ZONA 1 · Header institucional (azul UTA, compacto)
      ===================================================================== */}
      <header className="bg-uta-900 text-white shadow-[0_1px_0_rgba(255,255,255,0.08)]">
        <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6">
          {/* Branding */}
          <Link
            to="/"
            className="group flex items-center gap-3 rounded outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            aria-label="Ir al inicio de ServiceDesk UTA"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-white font-extrabold tracking-tight text-uta-900 shadow-sm">
              UTA
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-uta-100/80">
                Universidad Técnica de Ambato
              </span>
              <span className="text-sm font-bold tracking-wide sm:text-base">
                ServiceDesk UTA
              </span>
            </div>
          </Link>

          {user && (
            <>
              {/* --- Usuario en escritorio (md+) ---------------------------- */}
              <div className="hidden items-center gap-3 md:flex">
                <div className="max-w-[280px] text-right leading-tight">
                  <div className="truncate text-sm font-semibold">
                    {getAccountNameLabel(user)}
                  </div>
                  <div className="truncate text-[11px] text-uta-100/80">
                    <span className="truncate">{user.email}</span>
                    <span className="mx-1">·</span>
                    <span className="font-medium text-white/90">
                      {getRoleLabel(user.role)}
                    </span>
                  </div>
                </div>
                <div
                  className="flex h-9 w-9 select-none items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white ring-1 ring-white/20"
                  aria-hidden="true"
                >
                  {getInitials(user.name)}
                </div>
                <button
                  onClick={logout}
                  className="inline-flex items-center gap-1.5 rounded-md border border-white/25 bg-white/5 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                  aria-label="Cerrar sesión"
                >
                  <IconLogout />
                  <span className="hidden lg:inline">Cerrar sesión</span>
                </button>
              </div>

              {/* --- Usuario en móvil (<md) : avatar + menú desplegable ----- */}
              <div className="relative flex items-center gap-2 md:hidden">
                <button
                  onClick={() => setUserMenuOpen((v) => !v)}
                  className="flex h-9 items-center gap-2 rounded-full bg-white/10 pl-1 pr-3 text-xs font-medium text-white ring-1 ring-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                  aria-haspopup="menu"
                  aria-expanded={userMenuOpen}
                  aria-label="Menú del usuario"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-xs font-bold">
                    {getInitials(user.name)}
                  </span>
                  <span className="max-w-[110px] truncate">
                    {getAccountNameLabel(user).split(" ")[0]}
                  </span>
                </button>
                {userMenuOpen && (
                  <div
                    className="absolute right-0 top-11 z-40 w-64 rounded-lg bg-white p-3 text-gray-800 shadow-lg ring-1 ring-black/5"
                    role="menu"
                  >
                    <p className="truncate text-sm font-semibold text-uta-900">
                      {getAccountNameLabel(user)}
                    </p>
                    <p className="truncate text-xs text-gray-500">{user.email}</p>
                    <p className="mt-1 inline-flex rounded-full bg-uta-50 px-2 py-0.5 text-[11px] font-semibold text-uta-900">
                      {getRoleLabel(user.role)}
                    </p>
                    <button
                      onClick={logout}
                      className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-uta-300 bg-white px-3 py-1.5 text-sm font-medium text-uta-900 transition hover:bg-uta-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-uta-500"
                    >
                      <IconLogout /> Cerrar sesión
                    </button>
                  </div>
                )}

                {/* Botón hamburguesa (solo cuando hay nav) */}
                {showNav && (
                  <button
                    onClick={() => setMobileOpen(true)}
                    className="flex h-9 w-9 items-center justify-center rounded-md bg-white/10 text-white ring-1 ring-white/20 transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                    aria-label="Abrir menú de navegación"
                    aria-expanded={mobileOpen}
                  >
                    <IconMenu className="h-5 w-5" />
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </header>

      {/* =====================================================================
          ZONA 2 · Barra de navegación (estilo institucional azul).
          Se conserva el aspecto original: fondo azul + texto blanco + activo
          en azul-900. La corrección clave es de LAYOUT: `flex-wrap` para que
          los ítems salten a una segunda fila cuando no caben (nunca scroll
          horizontal ni palabras partidas), y `whitespace-nowrap` en cada link
          para preservar el nombre completo. Se oculta en <lg (drawer abajo).
      ===================================================================== */}
      {showNav && (
        <nav
          className="hidden bg-uta-700 text-white shadow-[0_2px_4px_rgba(15,23,42,0.08)] lg:block"
          aria-label="Navegación principal"
        >
          <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-0.5 px-4 py-1.5 sm:px-6">
            {items.map(({ to, label, Icon }) => {
              const active = activeTo === to;
              return (
                <Link
                  key={to}
                  to={to}
                  aria-current={active ? "page" : undefined}
                  className={[
                    "relative inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-2 text-sm transition-colors duration-200 xl:px-3",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
                    active
                      ? "bg-white/15 font-semibold text-white"
                      : "font-medium text-white/85 hover:bg-white/10 hover:text-white",
                  ].join(" ")}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" />
                  <span>{label}</span>
                  {/* Indicador inferior tipo pestaña (elegante, no ocupa espacio) */}
                  <span
                    aria-hidden="true"
                    className={[
                      "pointer-events-none absolute inset-x-2 -bottom-1.5 h-[2px] rounded-full transition-opacity duration-200",
                      active ? "bg-white opacity-100" : "opacity-0",
                    ].join(" ")}
                  />
                </Link>
              );
            })}
          </div>
        </nav>
      )}

      {/* =====================================================================
          Drawer móvil (<lg) : abre desde arriba, listado vertical.
      ===================================================================== */}
      {showNav && mobileOpen && (
        <div
          className="fixed inset-0 z-50 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menú principal"
        >
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-[1px]"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative ml-auto flex h-full w-full max-w-xs flex-col bg-white shadow-2xl">
            <div className="flex h-14 items-center justify-between border-b border-gray-200 px-4">
              <span className="text-sm font-semibold text-uta-900">Navegación</span>
              <button
                onClick={() => setMobileOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-uta-500"
                aria-label="Cerrar menú"
              >
                <IconClose className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {items.map(({ to, label, Icon }) => {
                const active = activeTo === to;
                return (
                  <Link
                    key={to}
                    to={to}
                    aria-current={active ? "page" : undefined}
                    className={[
                      "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-uta-500",
                      active
                        ? "bg-uta-50 text-uta-900"
                        : "text-gray-700 hover:bg-gray-50 hover:text-uta-900",
                    ].join(" ")}
                  >
                    <span
                      className={[
                        "flex h-8 w-8 items-center justify-center rounded-md",
                        active ? "bg-white text-uta-700 shadow-sm" : "text-gray-500",
                      ].join(" ")}
                    >
                      <Icon />
                    </span>
                    <span className="truncate">{label}</span>
                    {active && (
                      <span
                        aria-hidden="true"
                        className="ml-auto h-1.5 w-1.5 rounded-full bg-uta-700"
                      />
                    )}
                  </Link>
                );
              })}
            </div>
            {user && (
              <div className="border-t border-gray-200 p-3">
                <p className="truncate text-sm font-semibold text-uta-900">
                  {getAccountNameLabel(user)}
                </p>
                <p className="truncate text-xs text-gray-500">{user.email}</p>
                <p className="mt-1 inline-flex rounded-full bg-uta-50 px-2 py-0.5 text-[11px] font-semibold text-uta-900">
                  {getRoleLabel(user.role)}
                </p>
                <button
                  onClick={logout}
                  className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-uta-300 bg-white px-3 py-2 text-sm font-medium text-uta-900 transition hover:bg-uta-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-uta-500"
                >
                  <IconLogout /> Cerrar sesión
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          Contenido
      ===================================================================== */}
      <main className="flex-1 bg-uta-50">
        <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 sm:py-8">{children}</div>
      </main>

      {/* Footer institucional */}
      <footer className="bg-uta-900 py-4 text-center text-xs text-white/70">
        Universidad Técnica de Ambato · FISEI · ServiceDesk Institucional
      </footer>
    </div>
  );
}
