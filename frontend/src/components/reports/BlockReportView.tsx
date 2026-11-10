// Fase T — Resultado en pantalla del reporte por bloque, con el mismo formato del
// reporte de técnicos. El filtrado ocurre en el backend (GET /api/admin/reports/block).
import { fmtCalendarDay, fmtDate, fmtDateTime, periodText, statusLabel, type BlockReportData } from "../../lib/institutionalReport";
import { EmptyRow, Kpi, ReportTable, Section, SolutionCell, Td, ValidationCell } from "./ReportUi";

export default function BlockReportView({ report, generatedBy }: { report: BlockReportData; generatedBy: string }) {
  const individual = report.filters.technicianId ? (report.technicians[0] ?? null) : null;
  const heading = "mb-2 text-[11px] font-semibold uppercase tracking-widest text-gray-500";
  return (
    <div id="report-body" data-testid="block-report">
      <div className="card mb-6 overflow-hidden p-0">
        <div className="border-b-2 border-uta-700 bg-uta-50 px-6 py-4 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-uta-900">Universidad Técnica de Ambato</p>
          <p className="mt-0.5 text-xs text-gray-600">Sistema ServiceDesk UTA</p>
          <h2 className="mt-2 text-lg font-bold uppercase tracking-wide text-uta-900">
            {individual ? "Reporte individual por bloque" : "Reporte general por bloque"}
          </h2>
        </div>
        <section className="border-b border-gray-200 px-6 py-4">
          <h3 className={heading}>Información del bloque</h3>
          <dl className="grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-gray-500">Bloque</dt>
              <dd className="text-xl font-bold text-uta-900">{report.blockLabel}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">{individual ? "Técnico" : "Técnicos"}</dt>
              <dd className="text-base font-semibold text-gray-800">{individual ? individual.name : report.totals.technicians}</dd>
            </div>
          </dl>
        </section>
        <section className="border-b border-gray-200 px-6 py-4">
          <h3 className={heading}>Período del reporte</h3>
          <dl className="grid gap-2 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-gray-500">Período</dt>
              <dd className="text-sm font-bold uppercase text-uta-900">{periodText(report.range.from, report.range.to)}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Desde</dt>
              <dd className="text-sm font-semibold text-gray-800">{report.range.from ? fmtCalendarDay(report.range.from) : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Hasta</dt>
              <dd className="text-sm font-semibold text-gray-800">{report.range.to ? fmtCalendarDay(report.range.to) : "—"}</dd>
            </div>
          </dl>
        </section>
        <section className="px-6 py-4">
          <h3 className={heading}>Información de generación</h3>
          <dl className="grid gap-2 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-gray-500">Generado por</dt>
              <dd className="text-sm font-semibold text-gray-800">{generatedBy}</dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500">Fecha de generación</dt>
              <dd className="text-sm font-semibold text-gray-800">{fmtDateTime(report.generatedAt)}</dd>
            </div>
          </dl>
        </section>
      </div>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Resumen general</h2>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Técnicos" value={report.totals.technicians} accent="bg-uta-100 text-uta-900" />
        <Kpi label="Tickets" value={report.totals.tickets} accent="bg-blue-100 text-blue-800" />
        <Kpi label="Cerrados" value={report.totals.closed} accent="bg-gray-200 text-gray-800" />
        <Kpi label="Pend. aceptación" value={report.totals.pendingAcceptance} accent="bg-cyan-100 text-cyan-800" />
        <Kpi label="Rechazados" value={report.totals.rejectedByUser} accent="bg-orange-100 text-orange-800" />
        <Kpi label="En proceso" value={report.totals.inProgress} accent="bg-amber-100 text-amber-800" />
      </div>

      {report.technicians.length === 0 && (
        <div className="card mb-6">
          <EmptyRow msg={`${report.blockLabel} no tiene técnicos asignados, así que no hay nada que reportar.`} />
        </div>
      )}

      {report.technicians.map((t) => (
        <Section key={t.id} title={`${t.name} (${t.totals.tickets})`}>
          {t.activities.length === 0 ? (
            <EmptyRow msg="Sin actividades en el período." />
          ) : (
            <ReportTable heads={["Número", "Atención", "Servicio", "Ubicación", "Solicitante", "Solución utilizada", "Estado", "Validación digital"]}>
              {t.activities.map((a) => (
                <tr key={a.ticketId} className="hover:bg-gray-50">
                  <Td mono>{a.number}</Td>
                  <Td>{fmtDate(a.attendedAt)}</Td>
                  <Td>{a.serviceName ?? "—"}</Td>
                  <Td>{a.location ?? "—"}</Td>
                  <Td>{a.requesterName ?? "—"}</Td>
                  <Td>
                    {a.solutionName ? <SolutionCell name={a.solutionName} note={a.solutionNote} /> : a.solution ?? "Sin solución registrada"}
                  </Td>
                  <Td>{statusLabel(a.status)}</Td>
                  <Td>
                    <ValidationCell label={a.validation.label} code={a.validation.record?.code} />
                  </Td>
                </tr>
              ))}
            </ReportTable>
          )}
        </Section>
      ))}
    </div>
  );
}
