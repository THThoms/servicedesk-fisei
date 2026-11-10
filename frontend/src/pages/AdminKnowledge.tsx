// Sprint 3+ — Administración de la Base de Conocimiento (solo admin).
//
// Permite listar, buscar, filtrar por categoría, crear, editar y desactivar
// artículos. El backend hace soft delete para no romper tickets históricos
// que referencian el artículo (knowledgeArticleId en ticket_db).

import { useCallback, useEffect, useMemo, useState } from "react";
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
  isActive: boolean;
  updatedAt: string;
  createdAt: string;
}

interface ListResponse {
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

interface FormState {
  title: string;
  problemDescription: string;
  solution: string;
  keywords: string;
  serviceId: string;
}

const emptyForm: FormState = {
  title: "",
  problemDescription: "",
  solution: "",
  keywords: "",
  serviceId: "",
};

function toKeywords(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0)
    )
  );
}

export default function AdminKnowledge() {
  const [services, setServices] = useState<CatalogServiceItem[]>([]);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [serviceFilter, setServiceFilter] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  const [limit] = useState(20);

  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (serviceFilter) p.set("serviceId", serviceFilter);
    if (includeInactive) p.set("includeInactive", "true");
    p.set("page", String(page));
    p.set("limit", String(limit));
    return p.toString();
  }, [serviceFilter, includeInactive, page, limit]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<ListResponse>(`/api/knowledge/admin/list?${query}`);
      setData(r.data);
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api
      .get<{ services: CatalogServiceItem[] }>("/api/catalog/services?includeInactive=true")
      .then((r) => setServices(r.data.services))
      .catch(() => {
        /* no bloqueamos si falla el catálogo */
      });
  }, []);

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
  }

  function startEdit(article: KnowledgeArticle) {
    setEditingId(article.id);
    setForm({
      title: article.title,
      problemDescription: article.problemDescription,
      solution: article.solution,
      keywords: article.keywords.join(", "),
      serviceId: article.service?.id ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const keywords = toKeywords(form.keywords);
    if (keywords.length === 0) {
      setError("Debes indicar al menos una palabra clave (separadas por coma).");
      setSaving(false);
      return;
    }
    const payload = {
      title: form.title.trim(),
      problemDescription: form.problemDescription.trim(),
      solution: form.solution.trim(),
      keywords,
      serviceId: form.serviceId || null,
    };
    try {
      if (editingId) {
        await api.put(`/api/knowledge/${editingId}`, payload);
        setFlash("Artículo actualizado correctamente.");
      } else {
        await api.post("/api/knowledge", { ...payload, serviceId: payload.serviceId ?? undefined });
        setFlash("Artículo creado correctamente.");
      }
      resetForm();
      await load();
      window.setTimeout(() => setFlash(null), 4000);
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setSaving(false);
    }
  }

  async function deactivate(article: KnowledgeArticle) {
    if (
      !confirm(
        `Desactivar "${article.title}"? El artículo dejará de aparecer en las búsquedas, pero se preserva para tickets ya resueltos que lo referencian.`
      )
    ) {
      return;
    }
    setError(null);
    try {
      await api.delete(`/api/knowledge/${article.id}`);
      setFlash("Artículo desactivado.");
      await load();
      window.setTimeout(() => setFlash(null), 4000);
    } catch (err) {
      setError(extractApiError(err));
    }
  }

  async function reactivate(article: KnowledgeArticle) {
    setError(null);
    try {
      await api.put(`/api/knowledge/${article.id}`, { isActive: true });
      setFlash("Artículo reactivado.");
      await load();
      window.setTimeout(() => setFlash(null), 4000);
    } catch (err) {
      setError(extractApiError(err));
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / limit)) : 1;

  return (
    <Layout>
      <div className="mx-auto max-w-6xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-uta-900">
            Administración de la Base de Conocimiento
          </h1>
          <p className="mt-1 text-sm text-gray-600">
            Crear, editar y desactivar soluciones institucionales.
            La eliminación es lógica para no romper tickets históricos.
          </p>
        </div>

        {flash && (
          <div className="mb-4 rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900">
            {flash}
          </div>
        )}
        {error && (
          <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {/* Formulario crear / editar */}
        <form onSubmit={submitForm} className="card mb-6 space-y-4">
          <h2 className="text-lg font-bold text-uta-900">
            {editingId ? "Editar artículo" : "Nuevo artículo"}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="kb-title">
                Título <span className="text-red-600">*</span>
              </label>
              <input
                id="kb-title"
                className="input"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
                minLength={3}
                maxLength={200}
                disabled={saving}
              />
            </div>
            <div>
              <label className="label" htmlFor="kb-service">Categoría / servicio</label>
              <select
                id="kb-service"
                className="input"
                value={form.serviceId}
                onChange={(e) => setForm({ ...form, serviceId: e.target.value })}
                disabled={saving}
              >
                <option value="">— sin categoría —</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} {!s.isActive ? "(inactivo)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="label" htmlFor="kb-problem">
              Descripción del problema <span className="text-red-600">*</span>
            </label>
            <textarea
              id="kb-problem"
              rows={3}
              className="input"
              value={form.problemDescription}
              onChange={(e) => setForm({ ...form, problemDescription: e.target.value })}
              required
              minLength={10}
              disabled={saving}
            />
          </div>

          <div>
            <label className="label" htmlFor="kb-solution">
              Solución recomendada <span className="text-red-600">*</span>
            </label>
            <textarea
              id="kb-solution"
              rows={4}
              className="input"
              value={form.solution}
              onChange={(e) => setForm({ ...form, solution: e.target.value })}
              required
              minLength={10}
              disabled={saving}
            />
          </div>

          <div>
            <label className="label" htmlFor="kb-keywords">
              Palabras clave <span className="text-red-600">*</span>{" "}
              <span className="text-xs font-normal text-gray-500">(separadas por coma)</span>
            </label>
            <input
              id="kb-keywords"
              className="input"
              value={form.keywords}
              onChange={(e) => setForm({ ...form, keywords: e.target.value })}
              placeholder="wifi, red, conectividad"
              disabled={saving}
              required
            />
          </div>

          <div className="flex justify-end gap-2">
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                disabled={saving}
                className="rounded border border-gray-300 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancelar edición
              </button>
            )}
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Guardando…" : editingId ? "Guardar cambios" : "Crear artículo"}
            </button>
          </div>
        </form>

        {/* Filtros de listado */}
        <div className="card mb-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="kb-filter-service">Filtrar por categoría</label>
            <select
              id="kb-filter-service"
              className="input"
              value={serviceFilter}
              onChange={(e) => {
                setServiceFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Todas</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => {
                setIncludeInactive(e.target.checked);
                setPage(1);
              }}
            />
            Mostrar desactivados
          </label>
          <button
            type="button"
            className="ml-auto rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            onClick={load}
            disabled={loading}
          >
            {loading ? "Cargando…" : "Refrescar"}
          </button>
        </div>

        {/* Tabla */}
        {loading && (
          <div className="card py-12 text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-uta-200 border-t-uta-600" />
            <p className="text-sm text-gray-500">Cargando artículos…</p>
          </div>
        )}
        {!loading && data && data.results.length === 0 && (
          <div className="card py-8 text-center text-sm text-gray-500">
            No hay artículos que coincidan con los filtros.
          </div>
        )}
        {!loading && data && data.results.length > 0 && (
          <div className="card overflow-x-auto p-0">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="px-4 py-3 text-xs font-semibold uppercase text-gray-500">Título</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase text-gray-500">Categoría</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase text-gray-500">Actualizado</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase text-gray-500">Estado</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-500">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {data.results.map((a) => (
                  <tr key={a.id} className={!a.isActive ? "bg-gray-50 text-gray-500" : ""}>
                    <td className="px-4 py-3 font-medium text-uta-900">
                      {a.title}
                      <p className="text-xs font-normal text-gray-500 truncate max-w-xl">
                        {a.problemDescription}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-gray-700">
                      {a.service?.name ?? <span className="text-gray-400">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                      {new Date(a.updatedAt).toLocaleDateString("es-EC")}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {a.isActive ? (
                        <span className="badge-ok">Activo</span>
                      ) : (
                        <span className="inline-flex rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-semibold text-gray-700">
                          Inactivo
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(a)}
                          className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                        >
                          Editar
                        </button>
                        {a.isActive ? (
                          <button
                            type="button"
                            onClick={() => deactivate(a)}
                            className="rounded border border-red-300 bg-white px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                          >
                            Desactivar
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => reactivate(a)}
                            className="rounded border border-green-300 bg-white px-2.5 py-1 text-xs font-semibold text-green-800 hover:bg-green-50"
                          >
                            Reactivar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.total > 0 && (
          <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
            <span>
              {data.total} artículo{data.total === 1 ? "" : "s"} · página {page} / {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded border border-gray-300 bg-white px-3 py-1 disabled:opacity-50"
              >
                ← Anterior
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="rounded border border-gray-300 bg-white px-3 py-1 disabled:opacity-50"
              >
                Siguiente →
              </button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}
