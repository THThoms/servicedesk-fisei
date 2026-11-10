// HU-16 / Fase T - Pantalla Reportes (solo admin), con un único formulario:
//   - con bloque elegido → reporte del bloque (general o de uno de sus técnicos);
//   - sin bloque y con técnico → reporte individual del técnico.
//
// Reutiliza:
//   - Layout + card + Tailwind (misma línea visual)
//   - DonutChart / BarChart / LineChart (SVG custom, sin dependencias)
//   - getTechnicianDisplayLabel / getResponsibleAreaLabel del helper compartido
//   - Documento imprimible compartido (lib/institutionalReport): el navegador ofrece
//     "Guardar como PDF" en su diálogo de impresión, sin dependencias nuevas.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Layout } from "../components/Layout";
import BlockReportView from "../components/reports/BlockReportView";
import { api, extractApiError } from "../lib/api";
import DonutChart, { DonutSlice } from "../components/charts/DonutChart";
import BarChart from "../components/charts/BarChart";
import LineChart from "../components/charts/LineChart";
import {
  getResponsibleAreaLabel,
  getTechnicianDisplayLabel,
} from "../lib/technician";
import { getCurrentUser } from "../lib/auth";
import { EmptyRow, Kpi, Section, SolutionCell, Td, Th, ValidationCell } from "../components/reports/ReportUi";
import {
  STATUS_LABELS,
  PRIORITY_LABELS,
  actionLabel,
  fmtCalendarDay,
  blockReportHtml,
  fmtDate,
  fmtDateTime,
  printDocument,
  printableReason,
  priorityLabel,
  statusLabel,
  technicianReportHtml,
  type BlockReportData,
  type ReportTechnician,
  type TechnicianReportData,
} from "../lib/institutionalReport";

// -----------------------------------------------------------------------------
// Tipos: espejan el backend y se comparten con el documento imprimible.
// -----------------------------------------------------------------------------
type Technician = ReportTechnician;
type TechnicianReport = TechnicianReportData;

// -----------------------------------------------------------------------------
// Etiquetas y colores (mismos que AdminStats para consistencia visual)
// -----------------------------------------------------------------------------
const STATUS_COLORS: Record<string, string> = {
  abierto: "#3b82f6",
  en_proceso: "#f59e0b",
  escalado: "#8b5cf6",
  resuelto: "#10b981",
  pendiente_validacion: "#0ea5e9",
  cerrado: "#64748b",
};
const PRIORITY_COLORS: Record<string, string> = {
  baja: "#94a3b8",
  media: "#3b82f6",
  alta: "#f97316",
  critica: "#dc2626",
};

// -----------------------------------------------------------------------------
// Accesos rápidos de rango
// -----------------------------------------------------------------------------
function isoDay(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
function isoMonths(nMonths: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - nMonths);
  return d.toISOString().slice(0, 10);
}
function isoYearStart(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-01-01`;
}

// -----------------------------------------------------------------------------
// Períodos institucionales UTA — CONFIGURABLES.
// Agregar/modificar aquí cuando la universidad publique un nuevo calendario.
// El label es lo que se muestra en el encabezado del reporte y en el PDF.
// Las fechas se aplican tal cual al filtro from/to del backend.
// -----------------------------------------------------------------------------
interface InstitutionalPeriod {
  id: string;
  label: string;
  from: string; // YYYY-MM-DD
  to: string;
}
const INSTITUTIONAL_PERIODS: InstitutionalPeriod[] = [
  {
    id: "uta-2026-ene-jul",
    label: "PERÍODO ACADÉMICO ORDINARIO ENERO - JULIO 2026",
    from: "2026-01-01",
    to: "2026-07-31",
  },
  {
    id: "uta-2026-jul-dic",
    label: "PERÍODO ACADÉMICO JULIO - DICIEMBRE 2026",
    from: "2026-07-01",
    to: "2026-12-31",
  },
];

// Labels de los presets dinámicos. NO llamamos "período académico" a nada que
// no sea un período institucional real.
const PRESET_LABEL = {
  ALL: "TODO EL HISTORIAL",
  LAST30: "ÚLTIMOS 30 DÍAS",
  LAST3M: "ÚLTIMOS 3 MESES",
  LAST6M: "ÚLTIMOS 6 MESES",
  THIS_YEAR: "ESTE AÑO",
  CUSTOM: "RANGO PERSONALIZADO",
} as const;

// -----------------------------------------------------------------------------
// Componente principal
// -----------------------------------------------------------------------------
export default function AdminReporteTecnicos() {
  const admin = getCurrentUser();
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [blockFilter, setBlockFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [services, setServices] = useState<Array<{ id: string; name: string }>>([]);
  const [blockReport, setBlockReport] = useState<BlockReportData | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // Nombre del período que verá el reporte y el PDF. Se actualiza al aplicar
  // un preset o al elegir un período institucional; si el admin edita las
  // fechas manualmente pasa a "RANGO PERSONALIZADO" / "TODO EL HISTORIAL".
  const [periodLabel, setPeriodLabel] = useState<string>(PRESET_LABEL.ALL);
  // periodLabelSnapshot es lo que se muestra en el reporte generado (queda
  // congelado con lo que el admin eligió al hacer clic en "Generar").
  const [periodLabelSnapshot, setPeriodLabelSnapshot] = useState<string>(PRESET_LABEL.ALL);
  const [report, setReport] = useState<TechnicianReport | null>(null);
  const [loadingTechs, setLoadingTechs] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);

  // Carga inicial: lista de técnicos.
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ technicians: Technician[] }>("/api/admin/technicians")
      .then((r) => {
        if (!cancelled) setTechnicians(r.data.technicians);
      })
      .catch((err) => {
        if (!cancelled) setError(extractApiError(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingTechs(false);
      });
    api
      .get<{ services: Array<{ id: string; name: string }> }>("/api/catalog/services")
      .then((r) => {
        if (!cancelled) setServices(r.data.services ?? []);
      })
      .catch(() => {
        if (!cancelled) setServices([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rangeInvalid = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  // Con bloque elegido solo se ofrecen sus técnicos; DTIC nunca pertenece a un bloque.
  const techOptions = useMemo(
    () => (blockFilter ? technicians.filter((t) => t.role === "technician" && t.block === blockFilter) : technicians),
    [technicians, blockFilter]
  );
  const blockCount = (b: string) => technicians.filter((t) => t.role === "technician" && t.block === b).length;
  const clearReports = useCallback(() => {
    setReport(null);
    setBlockReport(null);
  }, []);

  const generate = useCallback(async () => {
    if (!blockFilter && !selectedId) {
      setError("Elige un bloque o un técnico.");
      return;
    }
    if (rangeInvalid) {
      setDateError("La fecha inicial no puede ser posterior a la fecha final.");
      return;
    }
    setDateError(null);
    setError(null);
    setLoadingReport(true);
    clearReports();
    try {
      const params = new URLSearchParams();
      if (dateFrom) params.set("from", dateFrom);
      if (dateTo) params.set("to", dateTo);
      if (blockFilter) {
        // El filtrado por bloque, técnico, estado y servicio ocurre en el backend.
        params.set("block", blockFilter);
        if (selectedId) params.set("technicianId", selectedId);
        if (statusFilter) params.set("status", statusFilter);
        if (serviceFilter) params.set("serviceId", serviceFilter);
        const r = await api.get<BlockReportData>(`/api/admin/reports/block?${params.toString()}`);
        setBlockReport(r.data);
      } else {
        const qs = params.toString();
        const r = await api.get<TechnicianReport>(`/api/admin/reports/technicians/${selectedId}${qs ? `?${qs}` : ""}`);
        setReport(r.data);
      }
      // Congela el nombre del período mostrado en el reporte generado.
      setPeriodLabelSnapshot(periodLabel);
    } catch (err) {
      setError(extractApiError(err));
    } finally {
      setLoadingReport(false);
    }
  }, [blockFilter, selectedId, statusFilter, serviceFilter, dateFrom, dateTo, rangeInvalid, periodLabel, clearReports]);

  function applyQuickRange(from: string, to: string, label: string) {
    setDateFrom(from);
    setDateTo(to);
    setPeriodLabel(label);
    setDateError(from && to && from > to ? "Rango inválido." : null);
  }
  function clearRange() {
    setDateFrom("");
    setDateTo("");
    setPeriodLabel(PRESET_LABEL.ALL);
    setDateError(null);
  }
  function applyInstitutionalPeriod(id: string) {
    if (!id) return;
    const p = INSTITUTIONAL_PERIODS.find((x) => x.id === id);
    if (!p) return;
    setDateFrom(p.from);
    setDateTo(p.to);
    setPeriodLabel(p.label);
    setDateError(null);
  }
  // Si el admin edita fechas manualmente, el label cae a RANGO PERSONALIZADO
  // (o TODO EL HISTORIAL si ambas quedan vacías). No se llama automáticamente
  // "período académico" a algo que no lo es.
  function markCustom(nextFrom: string, nextTo: string) {
    if (!nextFrom && !nextTo) setPeriodLabel(PRESET_LABEL.ALL);
    else setPeriodLabel(PRESET_LABEL.CUSTOM);
  }

  // Series para los gráficos (memo).
  const statusDonut: DonutSlice[] = useMemo(() => {
    if (!report) return [];
    return report.byStatus.map((r) => ({
      label: STATUS_LABELS[r.label] ?? r.label,
      value: r.count,
      color: STATUS_COLORS[r.label] ?? "#94a3b8",
    }));
  }, [report]);
  const priorityDonut: DonutSlice[] = useMemo(() => {
    if (!report) return [];
    return report.byPriority.map((r) => ({
      label: PRIORITY_LABELS[r.label] ?? r.label,
      value: r.count,
      color: PRIORITY_COLORS[r.label] ?? "#94a3b8",
    }));
  }, [report]);
  const serviceBars = useMemo(() => {
    if (!report) return [];
    return report.byService
      .slice(0, 10)
      .map((r) => ({ label: r.label, value: r.count }));
  }, [report]);
  const monthLine = useMemo(() => {
    if (!report) return [];
    return report.byMonth.map((p) => ({ date: p.month, value: p.count }));
  }, [report]);

  const reportTech = report?.technician ?? null;
  const areaLabel = reportTech
    ? (reportTech.areas.map(getResponsibleAreaLabel).join(" / ") || getResponsibleAreaLabel(reportTech.areas[0] ?? "TECHNICIANS"))
    : "—";

  // Imprimir y guardar como PDF usan el mismo diálogo del navegador.
  function openPrint() {
    let html: string;
    if (blockReport) {
      const notes = [
        blockReport.filters.status ? `Estado: ${statusLabel(blockReport.filters.status)}` : null,
        blockReport.filters.serviceId ? `Servicio: ${services.find((s) => s.id === blockReport.filters.serviceId)?.name ?? "seleccionado"}` : null,
      ].filter(Boolean);
      html = blockReportHtml(blockReport, {
        origin: window.location.origin,
        generatedBy: admin?.name ?? admin?.email,
        filterNote: notes.join(" · ") || null,
      });
    } else if (report) {
      html = technicianReportHtml(report, {
        origin: window.location.origin,
        generatedBy: admin?.name ?? admin?.email,
        periodName: periodLabelSnapshot,
        areaLabel,
        areaOf: getResponsibleAreaLabel,
      });
    } else {
      return;
    }
    if (!printDocument(html)) {
      setError("No se pudo preparar la impresión. Recarga la página e inténtalo de nuevo.");
    }
  }


  const cannotPrint = !report && (!blockReport || blockReport.technicians.length === 0);
  const selectedName = technicians.find((x) => x.id === selectedId)?.name;
  const reportKindText = blockFilter
    ? `${selectedName ? `reporte individual de ${selectedName} en` : "reporte general del"} ${blockFilter === "BLOQUE_1" ? "Bloque 1" : "Bloque 2"}`
    : selectedName
      ? `reporte individual de ${selectedName}`
      : "elige un bloque o un técnico";

  return (
    <Layout>
      <div className="mx-auto max-w-7xl">
        <div className="mb-4">
          <h1 className="text-2xl font-bold text-uta-900">Reportes</h1>
          <p className="mt-1 text-sm text-gray-600">
            Elige un bloque para su reporte general o un técnico para su reporte individual.
          </p>
        </div>

        {/* Formulario único: con bloque → reporte del bloque; sin bloque → reporte del técnico */}
        <div className="card mb-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Generar reporte
          </h2>
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <label className="label" htmlFor="block-select">Bloque</label>
              <select
                id="block-select"
                className="input"
                value={blockFilter}
                onChange={(e) => {
                  setBlockFilter(e.target.value);
                  setSelectedId("");
                  clearReports();
                }}
                disabled={loadingTechs || loadingReport}
              >
                <option value="">Sin bloque (por técnico)</option>
                <option value="BLOQUE_1">Bloque 1 ({blockCount("BLOQUE_1")} {blockCount("BLOQUE_1") === 1 ? "técnico" : "técnicos"})</option>
                <option value="BLOQUE_2">Bloque 2 ({blockCount("BLOQUE_2")} {blockCount("BLOQUE_2") === 1 ? "técnico" : "técnicos"})</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="tech-select">Seleccionar técnico</label>
              <select
                id="tech-select"
                className="input"
                value={selectedId}
                onChange={(e) => {
                  setSelectedId(e.target.value);
                  clearReports();
                }}
                disabled={loadingTechs || loadingReport}
              >
                <option value="">
                  {loadingTechs ? "Cargando técnicos…" : blockFilter ? "Todo el bloque" : "— Seleccionar —"}
                </option>
                {techOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {getTechnicianDisplayLabel(t, { includeEmail: false })}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="from">Desde</label>
              <input
                id="from"
                type="date"
                className="input"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  markCustom(e.target.value, dateTo);
                }}
                disabled={loadingReport}
              />
            </div>
            <div>
              <label className="label" htmlFor="to">Hasta</label>
              <input
                id="to"
                type="date"
                className="input"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  markCustom(dateFrom, e.target.value);
                }}
                disabled={loadingReport}
              />
            </div>
          </div>

          {blockFilter && (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <label className="label" htmlFor="status-select">Estado</label>
                <select id="status-select" className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} disabled={loadingReport}>
                  <option value="">Todos</option>
                  {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="service-select">Servicio</label>
                <select id="service-select" className="input" value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)} disabled={loadingReport}>
                  <option value="">Todos</option>
                  {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
          )}

          {/* Períodos institucionales UTA (opcional; configurables en INSTITUTIONAL_PERIODS) */}
          <div className="mt-3">
            <label className="label" htmlFor="uta-period">Período institucional UTA</label>
            <select
              id="uta-period"
              className="input max-w-md"
              value=""
              onChange={(e) => applyInstitutionalPeriod(e.target.value)}
              disabled={loadingReport}
            >
              <option value="">— Seleccionar período académico —</option>
              {INSTITUTIONAL_PERIODS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {blockFilter && !loadingTechs && techOptions.length === 0 && (
            <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="block-empty-hint">
              Este bloque no tiene técnicos asignados. Asígnalos en{" "}
              <Link to="/admin/bloques" className="font-semibold underline">Bloques</Link> para poder generar su reporte.
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={generate}
              disabled={(!blockFilter && !selectedId) || rangeInvalid || loadingReport}
              data-testid="report-generate"
              className="rounded bg-uta-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-uta-900 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {loadingReport ? "Generando…" : "Generar reporte"}
            </button>
            <button
              type="button"
              onClick={openPrint}
              disabled={cannotPrint}
              className="rounded border border-uta-700 bg-white px-4 py-1.5 text-sm font-semibold text-uta-700 hover:bg-uta-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              🖨 Imprimir
            </button>
            <button
              type="button"
              onClick={openPrint}
              disabled={cannotPrint}
              className="rounded border border-gray-300 bg-white px-4 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              title='En el diálogo elige "Guardar como PDF" como destino'
            >
              📄 Guardar PDF
            </button>
            <span className="ml-2 text-xs text-gray-500">Accesos rápidos:</span>
            <QuickBtn label="Todo" onClick={clearRange} disabled={loadingReport} />
            <QuickBtn label="Últimos 30 días" onClick={() => applyQuickRange(isoDay(-29), isoDay(0), PRESET_LABEL.LAST30)} disabled={loadingReport} />
            <QuickBtn label="Últimos 3 meses" onClick={() => applyQuickRange(isoMonths(3), isoDay(0), PRESET_LABEL.LAST3M)} disabled={loadingReport} />
            <QuickBtn label="Últimos 6 meses" onClick={() => applyQuickRange(isoMonths(6), isoDay(0), PRESET_LABEL.LAST6M)} disabled={loadingReport} />
            <QuickBtn label="Este año" onClick={() => applyQuickRange(isoYearStart(), isoDay(0), PRESET_LABEL.THIS_YEAR)} disabled={loadingReport} />
          </div>

          {/* Muestra el período que se aplicará al generar. */}
          <div className="mt-2 text-xs text-gray-500" data-testid="report-kind">
            Se generará: <strong className="text-uta-900">{reportKindText}</strong> · Período: <strong className="text-uta-900">{periodLabel}</strong>
          </div>
          {dateError && (
            <div className="mt-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
              {dateError}
            </div>
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {loadingReport && (
          <div className="card py-12 text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-uta-100 border-t-uta-700" />
            <p className="text-sm text-gray-500">Generando reporte…</p>
          </div>
        )}

        {!loadingReport && report && (
          <div id="report-body">
            {/* Encabezado del reporte — organizado en 4 bloques jerárquicos */}
            <div className="card mb-6 overflow-hidden p-0">
              {/* Bloque 1: Institucional */}
              <div className="border-b-2 border-uta-700 bg-uta-50 px-6 py-4 text-center">
                <p className="text-xs font-semibold uppercase tracking-widest text-uta-900">
                  Universidad Técnica de Ambato
                </p>
                <p className="mt-0.5 text-xs text-gray-600">Sistema ServiceDesk UTA</p>
                <h2 className="mt-2 text-lg font-bold uppercase tracking-wide text-uta-900">
                  Reporte individual de actividades del técnico
                </h2>
              </div>

              {/* Bloque 2: Técnico */}
              <section className="border-b border-gray-200 px-6 py-4">
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-gray-500">
                  Información del técnico
                </h3>
                <dl className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-gray-500">Técnico</dt>
                    <dd className="text-xl font-bold text-uta-900">{report.technician.name}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">Área</dt>
                    <dd className="text-base font-semibold text-gray-800">{areaLabel}</dd>
                  </div>
                </dl>
              </section>

              {/* Bloque 3: Período */}
              <section className="border-b border-gray-200 px-6 py-4">
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-gray-500">
                  Período del reporte
                </h3>
                <dl className="grid gap-2 sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-gray-500">Período</dt>
                    <dd className="text-sm font-bold uppercase text-uta-900">
                      {periodLabelSnapshot}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">Desde</dt>
                    <dd className="text-sm font-semibold text-gray-800">
                      {report.range.from ? fmtCalendarDay(report.range.from) : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">Hasta</dt>
                    <dd className="text-sm font-semibold text-gray-800">
                      {report.range.to ? fmtCalendarDay(report.range.to) : "—"}
                    </dd>
                  </div>
                </dl>
              </section>

              {/* Bloque 4: Generación */}
              <section className="px-6 py-4">
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-gray-500">
                  Información de generación
                </h3>
                <dl className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-gray-500">Generado por</dt>
                    <dd className="text-sm font-semibold text-gray-800">
                      {admin?.name ?? admin?.email ?? "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gray-500">Fecha de generación</dt>
                    <dd className="text-sm font-semibold text-gray-800">
                      {fmtDateTime(report.generatedAt)}
                    </dd>
                  </div>
                </dl>
              </section>
            </div>

            {/* KPIs */}
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
              Resumen general
            </h2>
            <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              <Kpi label="Asignados" value={report.summary.ticketsAssigned} accent="bg-uta-100 text-uta-900" />
              <Kpi label="Aceptaciones" value={report.summary.ticketsAccepted} accent="bg-cyan-100 text-cyan-800" />
              <Kpi label="En proceso" value={report.summary.ticketsInProgress} accent="bg-amber-100 text-amber-800" />
              <Kpi label="Resueltos" value={report.summary.ticketsResolved} accent="bg-emerald-100 text-emerald-800" />
              <Kpi label="Cerrados" value={report.summary.ticketsClosed} accent="bg-gray-200 text-gray-800" />
              <Kpi label="Reescalados" value={report.summary.reescalations} accent="bg-orange-100 text-orange-800" />
              <Kpi label="Aportaciones" value={report.summary.contributions} accent="bg-blue-100 text-blue-800" />
              <Kpi label="Servicios" value={report.summary.distinctServices} accent="bg-slate-100 text-slate-800" />
            </div>

            {/* Gráficos */}
            <div className="mb-6 grid gap-4 lg:grid-cols-2">
              <DonutChart title="Tickets por estado" data={statusDonut} centerLabel="Tickets" />
              <DonutChart title="Tickets por prioridad" data={priorityDonut} centerLabel="Tickets" />
            </div>
            <div className="mb-6 grid gap-4 lg:grid-cols-1">
              <BarChart title="Tickets por servicio (top 10)" data={serviceBars} variant="horizontal" />
            </div>
            <div className="mb-6">
              <LineChart title="Tickets creados por mes" data={monthLine} />
            </div>

            {/* Historial completo */}
            <Section title={`Historial de tickets (${report.tickets.length})`}>
              {report.tickets.length === 0 ? (
                <EmptyRow msg="Sin tickets en el período seleccionado." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <Th>Número</Th><Th>Fecha</Th><Th>Servicio</Th><Th>Ubicación</Th><Th>Área</Th>
                        <Th>Prioridad</Th><Th>Estado</Th><Th>Solicitante</Th><Th>Solución utilizada</Th><Th>Resuelto</Th><Th>Validación digital</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {report.tickets.map((t) => (
                        <tr key={t.id} className="hover:bg-gray-50">
                          <Td mono>{t.number}</Td>
                          <Td>{fmtDate(t.createdAt)}</Td>
                          <Td>{t.serviceName ?? "—"}</Td>
                          <Td>{t.location ?? "—"}</Td>
                          <Td>{getResponsibleAreaLabel(t.responsibleArea)}</Td>
                          <Td>{priorityLabel(t.priority)}</Td>
                          <Td>{statusLabel(t.status)}</Td>
                          <Td>{t.requesterName ?? "—"}</Td>
                          <Td><SolutionCell name={t.solutionName} /></Td>
                          <Td>{t.resolvedAt ? fmtDate(t.resolvedAt) : "—"}</Td>
                          <Td>
                            {t.validation ? (
                              <ValidationCell
                                label={t.validation.label}
                                code={t.validation.record?.code}
                                title={t.validation.record ? `${t.validation.record.code} · ${fmtDateTime(t.validation.record.decidedAt, true)}` : undefined}
                              />
                            ) : "—"}
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            {/* Actividad */}
            <Section title={`Actividad del técnico (${report.activity.length})`}>
              {report.activity.length === 0 ? (
                <EmptyRow msg="Sin actividad registrada." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <Th>Fecha</Th><Th>Ticket</Th><Th>Acción</Th><Th>Descripción</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {report.activity.map((a) => (
                        <tr key={a.id} className="hover:bg-gray-50">
                          <Td>{fmtDate(a.createdAt)}</Td>
                          <Td mono>{a.ticketNumber ?? "—"}</Td>
                          <Td>{actionLabel(a.actionType)}</Td>
                          <Td>{printableReason(a.description ?? a.reason ?? a.workDone) || "—"}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            {/* Reescalamientos */}
            <Section title={`Reescalamientos (${report.escalations.length})`}>
              {report.escalations.length === 0 ? (
                <EmptyRow msg="Sin reescalamientos." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <Th>Ticket</Th><Th>Fecha</Th><Th>Área anterior</Th><Th>Área nueva</Th>
                        <Th>Motivo</Th><Th>Trabajo previo</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {report.escalations.map((e, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <Td mono>{e.ticketNumber ?? "—"}</Td>
                          <Td>{fmtDate(e.createdAt)}</Td>
                          <Td>{e.previousArea ? getResponsibleAreaLabel(e.previousArea) : "—"}</Td>
                          <Td>{e.newArea ? getResponsibleAreaLabel(e.newArea) : "—"}</Td>
                          <Td>{printableReason(e.reason) || "—"}</Td>
                          <Td>{e.workDone ?? "—"}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            {/* Resoluciones */}
            <Section title={`Resoluciones (${report.resolutions.length})`}>
              {report.resolutions.length === 0 ? (
                <EmptyRow msg="Sin resoluciones registradas." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <Th>Ticket</Th><Th>Servicio</Th><Th>Ubicación</Th><Th>Problema</Th><Th>Resuelto</Th><Th>Solución utilizada</Th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {report.resolutions.map((x, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <Td mono>{x.ticketNumber}</Td>
                          <Td>{x.serviceName ?? "—"}</Td>
                          <Td>{x.location ?? "—"}</Td>
                          <Td>{x.problemDescription ?? "—"}</Td>
                          <Td>{x.resolvedAt ? fmtDate(x.resolvedAt) : "—"}</Td>
                          <Td><SolutionCell name={x.solutionName} note={x.resolutionSummary} /></Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            {/* Aportaciones */}
            <Section title={`Aportaciones (${report.contributions.length})`}>
              {report.contributions.length === 0 ? (
                <EmptyRow msg="Sin aportaciones." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr><Th>Ticket</Th><Th>Fecha</Th><Th>Descripción</Th></tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {report.contributions.map((c, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <Td mono>{c.ticketNumber ?? "—"}</Td>
                          <Td>{fmtDate(c.createdAt)}</Td>
                          <Td>{c.description ?? "—"}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          </div>
        )}

        {!loadingReport && blockReport && <BlockReportView report={blockReport} generatedBy={admin?.name ?? admin?.email ?? "—"} />}
      </div>
    </Layout>
  );
}

// -----------------------------------------------------------------------------
// Sub-componentes propios de esta pantalla
// -----------------------------------------------------------------------------
function QuickBtn({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-600 hover:border-uta-300 hover:text-uta-900 disabled:opacity-50"
    >
      {label}
    </button>
  );
}
