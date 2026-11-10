// Sprint L · P2 — Componente para renderizar imágenes que requieren
// autenticación JWT. El navegador NO puede pasar `Authorization` en un
// `<img src>`, así que hacemos fetch con Bearer, tomamos el binario como
// blob y creamos un objectURL de vida corta.
//
// Detalle:
//   · Si `src` es absoluta (Cloudinary público) → se usa tal cual (`<img>`).
//   · Si es relativa (endpoint del gateway) → fetch autenticado + blob URL.
//   · Estados: loading | loaded | error, con mensajes explícitos ("Cargando
//     imagen…", "No se pudo cargar la imagen") — no aparece "No disponible"
//     por confusión de URL.
//
// El objectURL se revoca al desmontar para no filtrar memoria en cambios
// rápidos de vista.

import { useEffect, useMemo, useState } from "react";
import { api, isCancelled } from "../lib/api";

interface Props {
  /**
   * URL de la imagen. Puede ser:
   *   · Absoluta https:// (p.ej. Cloudinary) — se renderiza directo sin fetch.
   *   · Relativa /api/tickets/x/attachments/y — se fetchea con Bearer y se
   *     convierte a blob URL.
   */
  src: string | null | undefined;
  alt: string;
  /** className aplicada al <img>. */
  className?: string;
  /** Callback opcional al hacer click sobre la imagen cargada. */
  onClick?: () => void;
  /** Título mostrado en tooltip (opcional). */
  title?: string;
  /**
   * Alto máximo en clases Tailwind (se aplica al placeholder para no
   * hacer salto de layout mientras carga). Default "h-24".
   */
  placeholderClassName?: string;
}

export default function AuthenticatedImage({
  src,
  alt,
  className,
  onClick,
  title,
  placeholderClassName = "h-24",
}: Props) {
  const isAbsolute = useMemo(() => !!src && /^https?:\/\//i.test(src), [src]);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">(
    "idle"
  );

  // Descarga autenticada (solo para URLs relativas).
  useEffect(() => {
    if (!src || isAbsolute) return;
    const ctrl = new AbortController();
    let revoked = false;
    let localUrl: string | null = null;
    setState("loading");
    (async () => {
      try {
        const r = await api.get<Blob>(src, {
          responseType: "blob",
          signal: ctrl.signal,
        });
        if (revoked) return;
        localUrl = URL.createObjectURL(r.data);
        setObjectUrl(localUrl);
        setState("ready");
      } catch (err) {
        if (isCancelled(err)) return;
        setState("error");
      }
    })();
    return () => {
      revoked = true;
      ctrl.abort();
      if (localUrl) URL.revokeObjectURL(localUrl);
    };
  }, [src, isAbsolute]);

  if (!src) {
    return (
      <div
        className={`flex ${placeholderClassName} w-full items-center justify-center rounded bg-gray-100 text-[10px] text-gray-400 ${className ?? ""}`}
      >
        Sin imagen
      </div>
    );
  }

  // URL absoluta pública (Cloudinary) — img directo con onError.
  if (isAbsolute) {
    return (
      <img
        src={src}
        alt={alt}
        title={title}
        loading="lazy"
        onClick={onClick}
        className={className}
        onError={(e) => {
          const el = e.currentTarget;
          el.replaceWith(
            Object.assign(document.createElement("span"), {
              className: `flex ${placeholderClassName} w-full items-center justify-center rounded bg-red-50 text-[10px] text-red-600`,
              textContent: "No se pudo cargar la imagen",
            })
          );
        }}
      />
    );
  }

  if (state === "loading" || state === "idle") {
    return (
      <div
        className={`flex ${placeholderClassName} w-full items-center justify-center rounded bg-gray-100 text-[10px] text-gray-500 ${className ?? ""}`}
        aria-busy="true"
      >
        Cargando imagen…
      </div>
    );
  }

  if (state === "error" || !objectUrl) {
    return (
      <div
        className={`flex ${placeholderClassName} w-full items-center justify-center rounded bg-red-50 text-[10px] text-red-600 ${className ?? ""}`}
        role="status"
      >
        No se pudo cargar la imagen
      </div>
    );
  }

  return (
    <img
      src={objectUrl}
      alt={alt}
      title={title}
      onClick={onClick}
      loading="lazy"
      className={className}
    />
  );
}
