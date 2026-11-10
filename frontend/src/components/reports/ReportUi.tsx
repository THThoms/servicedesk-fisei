// Piezas de pantalla de los reportes: el formato original del reporte de técnicos,
// compartido con el reporte por bloque y con la pantalla Bloques.
import type { ReactNode } from "react";

export function Kpi({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="card flex flex-col items-center justify-center text-center">
      <span className={`mb-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${accent}`}>
        {label}
      </span>
      <p className="text-2xl font-extrabold text-gray-900">{value}</p>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
        {title}
      </h2>
      <div className="card p-0">{children}</div>
    </div>
  );
}

export function Th({ children }: { children: ReactNode }) {
  return (
    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">
      {children}
    </th>
  );
}

export function Td({ children, mono }: { children: ReactNode; mono?: boolean }) {
  return (
    <td className={`px-4 py-3 text-gray-700 ${mono ? "whitespace-nowrap font-mono font-semibold text-uta-900" : ""}`}>
      {children}
    </td>
  );
}

export function EmptyRow({ msg }: { msg: string }) {
  return <p className="py-6 text-center text-sm text-gray-500">{msg}</p>;
}

export function ReportTable({ heads, children }: { heads: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>{heads.map((h) => <Th key={h}>{h}</Th>)}</tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">{children}</tbody>
      </table>
    </div>
  );
}

/** Validación digital en una celda: el estado real y, si existe, el código de la constancia. */
export function ValidationCell({ label, code, title }: { label: string; code?: string | null; title?: string }) {
  return (
    <span title={title}>
      {label}
      {code ? <span className="block font-mono text-[10px] text-gray-500">{code}</span> : null}
    </span>
  );
}

/** Nombre de la solución utilizada y, debajo, la nota del técnico. */
export function SolutionCell({ name, note }: { name: string | null | undefined; note?: string | null }) {
  if (!name) return <>{note ?? "—"}</>;
  return (
    <>
      <span className="font-semibold text-gray-900">{name}</span>
      {note ? <span className="block text-xs text-gray-500">{note}</span> : null}
    </>
  );
}
