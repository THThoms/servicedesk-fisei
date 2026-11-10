// HU-10 (Sprint 3+) - Base de Conocimiento institucional.
//
// La búsqueda por TEXTO es opcional: si el usuario solo elige una categoría,
// se listan automáticamente todos los artículos activos de esa categoría.
// El backend acepta:
//   - solo `q`             → texto en todas las categorías
//   - solo `serviceId`     → todos los artículos de esa categoría
//   - `q` + `serviceId`    → texto dentro de esa categoría
//   - sin filtros          → todos los artículos activos (paginado)

import { useCallback, useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { api, extractApiError } from "../lib/api";

interface KnowledgeService {
  id: string;
  name: string;
}

interface KnowledgeArticle {
  id: string;
  title: string;
  problemDescription: string;
  solution: string;
  keywords: string[];
  service: KnowledgeService | null;
  updatedAt: string;
  createdAt: string;
}

interface SearchResponse {
  query: string;
  total: number;
  page: number;
  limit: number;
  results: KnowledgeArticle[];
}

interface CatalogServiceItem {
  id: string;
  name: string;
  isActive: boolean;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-EC", {
    year: "numeric",
    month: "long",
    day: "2-digit",
  });
}

export default function BaseConocimiento() {
  const [query, setQuery] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [services, setServices] = useState<CatalogServiceItem[]>([]);

  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<string | null>(null);

  // Carga inicial: catálogo de servicios para el filtro.
  useEffect(() => {
    api
      .get<{ services: CatalogServiceItem[] }>("/api/catalog/services")
      .then((r) => setServices(r.data.services))
      .catch(() => {
        /* No bloqueamos la búsqueda si el catálogo falla */
      });
  }, []);

  // Función de búsqueda reusable, sin `q` obligatorio.
  const runSearch = useCallback(async (q: string, svc: string) => {
    setError(null);
    setValidation(null);
    const trimmed = q.trim();
    // Solo validamos longitud si el usuario tipeó algo. Vacío = permitido.
    if (trimmed.length > 0 && trimmed.length < 2) {
      setValidation("Si escribes texto, debe tener al menos 2 caracteres.");
      setData(null);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (trimmed) params.set("q", trimmed);
      if (svc) params.set("serviceId", svc);
      const qs = params.toString();
      const url = qs ? `/api/knowledge/search?${qs}` : "/api/knowledge/search";
      const r = await api.get<SearchResponse>(url);
      setData(r.data);
    } catch (err) {
      setError(extractApiError(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await runSearch(query, serviceId);
  }

  // Cuando el usuario cambia la CATEGORÍA, refrescamos automáticamente:
  //  - si hay texto válido, aplica ambos filtros
  //  - si no hay texto, lista todos los artículos de esa categoría
  //  - "Todos los servicios" muestra todo lo que el texto (si existe) permita
  function handleServiceChange(nextServiceId: string) {
    setServiceId(nextServiceId);
    // Trigger inmediato sin necesidad de presionar "Buscar"
    void runSearch(query, nextServiceId);
  }

  function reset() {
    setQuery("");
    setServiceId("");
    setData(null);
    setError(null);
    setValidation(null);
  }

  return (
    <Layout>
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-uta-900">
            Base de conocimiento institucional
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Consulta soluciones registradas para incidencias frecuentes.
            Puedes filtrar solo por categoría o combinar categoría con palabras clave.
          </p>
        </div>

        {/* Buscador */}
        <form onSubmit={handleSubmit} className="card mb-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_240px_auto] sm:items-end">
            <div>
              <label htmlFor="kb-query" className="label">
                Palabras clave <span className="text-xs font-normal text-gray-500">(opcional)</span>
              </label>
              <input
                id="kb-query"
                type="text"
                className="input"
                placeholder="Ej: VPN, WiFi, impresora…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={loading}
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="kb-service" className="label">Categoría / servicio</label>
              <select
                id="kb-service"
                className="input"
                value={serviceId}
                onChange={(e) => handleServiceChange(e.target.value)}
                disabled={loading || services.length === 0}
              >
                <option value="">Todas las categorías</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={loading}
                className="btn-primary"
              >
                {loading ? "Buscando…" : "Buscar"}
              </button>
              {(data || error || validation) && (
                <button
                  type="button"
                  onClick={reset}
                  disabled={loading}
                  className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Limpiar
                </button>
              )}
            </div>
          </div>

          {validation && (
            <p className="mt-2 text-sm text-red-600">{validation}</p>
          )}
        </form>

        {/* Loading */}
        {loading && (
          <div className="card py-12 text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-uta-200 border-t-uta-600" />
            <p className="text-sm text-gray-500">Buscando soluciones…</p>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="card border-red-300 bg-red-50 py-6 text-center text-sm text-red-800">
            No se pudo cargar la base de conocimiento.
            <p className="mt-1 text-xs text-red-700">{error}</p>
          </div>
        )}

        {/* Sin búsqueda aún */}
        {!loading && !error && !data && !validation && (
          <div className="card py-12 text-center text-sm text-gray-500">
            <svg className="mx-auto mb-3 h-12 w-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            Selecciona una categoría o escribe palabras clave para consultar la base de conocimiento.
          </div>
        )}

        {/* Resultados */}
        {!loading && !error && data && (
          <div>
            <p className="mb-3 text-sm text-gray-600">
              {data.total} resultado{data.total === 1 ? "" : "s"}
              {data.query ? (
                <>
                  {" "}para <span className="font-semibold text-gray-800">"{data.query}"</span>
                </>
              ) : null}
              {serviceId ? (
                <>
                  {" "}en categoría{" "}
                  <span className="font-semibold text-gray-800">
                    {services.find((s) => s.id === serviceId)?.name ?? "—"}
                  </span>
                </>
              ) : null}
            </p>

            {data.results.length === 0 ? (
              <div className="card py-12 text-center text-sm font-medium text-gray-500">
                No se encontraron soluciones relacionadas.
              </div>
            ) : (
              <div className="space-y-3">
                {data.results.map((art) => (
                  <ArticleCard key={art.id} article={art} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}

function ArticleCard({ article }: { article: KnowledgeArticle }) {
  return (
    <article className="card">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-base font-bold text-uta-900">{article.title}</h2>
        <span className="text-xs text-gray-500">
          Actualizado: {formatDate(article.updatedAt)}
        </span>
      </div>

      {article.service && (
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-uta-700">
          {article.service.name}
        </p>
      )}

      <div className="mb-3">
        <h3 className="text-xs font-semibold uppercase text-gray-500">Problema</h3>
        <p className="mt-0.5 text-sm text-gray-700 whitespace-pre-wrap">{article.problemDescription}</p>
      </div>

      <div className="mb-3">
        <h3 className="text-xs font-semibold uppercase text-gray-500">Solución recomendada</h3>
        <p className="mt-0.5 text-sm text-gray-800 whitespace-pre-wrap">{article.solution}</p>
      </div>

      {article.keywords.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {article.keywords.map((k) => (
            <span key={k} className="inline-flex rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
              #{k}
            </span>
          ))}
        </div>
      )}
    </article>
  );
}
