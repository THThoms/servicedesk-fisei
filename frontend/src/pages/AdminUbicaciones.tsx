// Sprint 3+ — Administración de ubicaciones (solo admin).
// CRUD sobre catalog_db.locations con soft delete.

import { useCallback, useEffect, useState } from "react";
import { Layout } from "../components/Layout";
import { api, extractApiError } from "../lib/api";

interface Location {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export default function AdminUbicaciones() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<{ locations: Location[] }>(
        "/api/catalog/locations?includeInactive=true"
      );
      setLocations(r.data.locations);
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (newName.trim().length < 2) {
      setError("El nombre debe tener al menos 2 caracteres.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await api.post("/api/catalog/locations", { name: newName.trim() });
      setNewName("");
      setFlash("Ubicación creada.");
      await load();
      window.setTimeout(() => setFlash(null), 4000);
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setCreating(false);
    }
  }

  async function saveEdit(id: string) {
    if (editName.trim().length < 2) {
      setError("El nombre debe tener al menos 2 caracteres.");
      return;
    }
    setError(null);
    try {
      await api.put(`/api/catalog/locations/${id}`, { name: editName.trim() });
      setEditingId(null);
      setFlash("Ubicación actualizada.");
      await load();
      window.setTimeout(() => setFlash(null), 4000);
    } catch (err) {
      setError(extractApiError(err));
    }
  }

  async function deactivate(loc: Location) {
    if (!confirm(`¿Desactivar "${loc.name}"? Los tickets históricos se mantienen intactos.`)) {
      return;
    }
    setError(null);
    try {
      await api.delete(`/api/catalog/locations/${loc.id}`);
      setFlash("Ubicación desactivada.");
      await load();
      window.setTimeout(() => setFlash(null), 4000);
    } catch (err) {
      setError(extractApiError(err));
    }
  }

  async function reactivate(loc: Location) {
    setError(null);
    try {
      await api.put(`/api/catalog/locations/${loc.id}`, { isActive: true });
      setFlash("Ubicación reactivada.");
      await load();
      window.setTimeout(() => setFlash(null), 4000);
    } catch (err) {
      setError(extractApiError(err));
    }
  }

  return (
    <Layout>
      <div className="mx-auto max-w-4xl">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-uta-900">Ubicaciones de la FISEI</h1>
          <p className="mt-1 text-sm text-gray-600">
            Catálogo institucional. Se muestran en el formulario de creación de tickets.
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

        <form onSubmit={create} className="card mb-6 flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="label" htmlFor="loc-new">Nueva ubicación</label>
            <input
              id="loc-new"
              className="input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Ej: Laboratorio 9"
              minLength={2}
              maxLength={200}
              disabled={creating}
            />
          </div>
          <button className="btn-primary" type="submit" disabled={creating}>
            {creating ? "Creando…" : "Crear ubicación"}
          </button>
        </form>

        {loading && (
          <div className="card py-12 text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-uta-200 border-t-uta-600" />
            <p className="text-sm text-gray-500">Cargando ubicaciones…</p>
          </div>
        )}

        {!loading && locations.length === 0 && (
          <div className="card py-8 text-center text-sm text-gray-500">
            Aún no hay ubicaciones registradas.
          </div>
        )}

        {!loading && locations.length > 0 && (
          <div className="card overflow-x-auto p-0">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="px-4 py-3 text-xs font-semibold uppercase text-gray-500">Nombre</th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase text-gray-500">Estado</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-gray-500">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {locations.map((loc) => {
                  const editing = editingId === loc.id;
                  return (
                    <tr key={loc.id} className={!loc.isActive ? "bg-gray-50 text-gray-500" : ""}>
                      <td className="px-4 py-3 font-medium text-uta-900">
                        {editing ? (
                          <input
                            className="input"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            autoFocus
                            minLength={2}
                            maxLength={200}
                          />
                        ) : (
                          loc.name
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {loc.isActive ? (
                          <span className="badge-ok">Activa</span>
                        ) : (
                          <span className="inline-flex rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-semibold text-gray-700">
                            Inactiva
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          {editing ? (
                            <>
                              <button
                                type="button"
                                onClick={() => saveEdit(loc.id)}
                                className="rounded bg-uta-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-uta-800"
                              >
                                Guardar
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                              >
                                Cancelar
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingId(loc.id);
                                  setEditName(loc.name);
                                }}
                                className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                              >
                                Renombrar
                              </button>
                              {loc.isActive ? (
                                <button
                                  type="button"
                                  onClick={() => deactivate(loc)}
                                  className="rounded border border-red-300 bg-white px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50"
                                >
                                  Desactivar
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => reactivate(loc)}
                                  className="rounded border border-green-300 bg-white px-2.5 py-1 text-xs font-semibold text-green-800 hover:bg-green-50"
                                >
                                  Reactivar
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
