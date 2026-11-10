// =============================================================================
// Fase T — Asignación de técnicos a los bloques físicos de la FISEI (admin).
//
// Esta pantalla solo clasifica: cada técnico (rol technician) va al Bloque 1 o al
// Bloque 2. El bloque es una clasificación administrativa: NO es un rol ni da acceso
// a tickets. DTIC conserva su clasificación independiente y no aparece aquí.
// El reporte por bloque está en la pantalla Reportes.
// =============================================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { Layout } from "../components/Layout";
import { ReportTable, Td } from "../components/reports/ReportUi";
import { api, extractApiError } from "../lib/api";

type Block = "BLOQUE_1" | "BLOQUE_2";
const BLOCK_LABEL: Record<Block, string> = { BLOQUE_1: "Bloque 1", BLOQUE_2: "Bloque 2" };

interface Technician { id: string; name: string; email: string; role: string; block: Block | null }

export default function AdminBloques() {
  const [techs, setTechs] = useState<Technician[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"ALL" | Block | "NONE">("ALL");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    return api.get<{ technicians: Technician[] }>("/api/auth/technicians", { params: { role: "technician" } })
      .then((r) => setTechs(r.data.technicians))
      .catch((err) => setMsg({ ok: false, text: extractApiError(err) }))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(
    () => ({
      BLOQUE_1: techs.filter((t) => t.block === "BLOQUE_1").length,
      BLOQUE_2: techs.filter((t) => t.block === "BLOQUE_2").length,
      NONE: techs.filter((t) => !t.block).length,
    }),
    [techs]
  );
  const visible = useMemo(
    () => techs.filter((t) => (filter === "ALL" ? true : filter === "NONE" ? !t.block : t.block === filter)),
    [techs, filter]
  );

  async function saveBlock(t: Technician, value: string) {
    setSavingId(t.id);
    setMsg(null);
    try {
      await api.patch(`/api/auth/technicians/${t.id}/block`, { block: value || null });
      setMsg({ ok: true, text: `${t.name}: ${value ? BLOCK_LABEL[value as Block] : "sin bloque"}` });
      await load();
    } catch (err) {
      setMsg({ ok: false, text: extractApiError(err) });
    } finally {
      setSavingId(null);
    }
  }

  return (
    <Layout>
      <div className="mx-auto max-w-5xl">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-uta-900">Bloques de la FISEI</h1>
            <p className="mt-1 text-sm text-gray-600">Asigna cada técnico a su bloque.</p>
          </div>
          <div>
            <label className="label" htmlFor="tech-filter">Mostrar</label>
            <select id="tech-filter" className="input" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} data-testid="tech-filter">
              <option value="ALL">Todos ({techs.length})</option>
              <option value="BLOQUE_1">Bloque 1 ({counts.BLOQUE_1})</option>
              <option value="BLOQUE_2">Bloque 2 ({counts.BLOQUE_2})</option>
              <option value="NONE">Sin bloque ({counts.NONE})</option>
            </select>
          </div>
        </div>

        {msg && (
          <p role="status" className={`mb-3 rounded px-3 py-2 text-sm ${msg.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
            {msg.text}
          </p>
        )}

        <div className="card p-0">
          <ReportTable heads={["Técnico", "Correo", "Bloque"]}>
            {visible.map((t) => (
              <tr key={t.id}>
                <Td><span className="font-medium text-gray-900">{t.name}</span></Td>
                <Td>{t.email}</Td>
                <Td>
                  <select
                    className="rounded border border-gray-300 px-2 py-1 text-sm"
                    value={t.block ?? ""}
                    disabled={savingId === t.id}
                    onChange={(e) => saveBlock(t, e.target.value)}
                    aria-label={`Bloque de ${t.name}`}
                  >
                    <option value="">Sin bloque</option>
                    <option value="BLOQUE_1">Bloque 1</option>
                    <option value="BLOQUE_2">Bloque 2</option>
                  </select>
                </Td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-8 text-center text-sm text-gray-500">
                  {loading ? "Cargando técnicos…" : "Sin técnicos con este filtro."}
                </td>
              </tr>
            )}
          </ReportTable>
        </div>
      </div>
    </Layout>
  );
}
