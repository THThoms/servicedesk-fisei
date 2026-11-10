import axios from "axios";
import { env } from "../config/env";
// Sprint B: enums desde src/domain/enums.ts.
import { Level, ResponsibleArea } from "../domain/enums";

export interface CatalogRoutingRule {
  levelEntry: Level;
  priorityHigh: Level | null;
  priorityCritical: Level | null;
  isCritical: boolean;
}

export interface CatalogService {
  id: string;
  name: string;
  isActive: boolean;
  levelEntry: Level;
  // Sprint 2 (rev): área responsable. Default TECHNICIANS si el catálogo aún
  // no lo expone (compat con instalaciones antiguas).
  responsibleArea?: ResponsibleArea;
  routingRule: CatalogRoutingRule | null;
}

// Cliente HTTP hacia catalog-service. Comunicación interna entre microservicios
// (red Docker). NO pasa por el API Gateway porque es tráfico backend-to-backend.
export async function fetchService(serviceId: string, userToken: string): Promise<CatalogService> {
  const url = `${env.catalogServiceUrl}/services/${serviceId}`;
  try {
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${userToken}` },
      timeout: 5000,
    });
    return response.data.service as CatalogService;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      throw new ServiceNotFoundError(serviceId);
    }
    throw err;
  }
}

export class ServiceNotFoundError extends Error {
  constructor(serviceId: string) {
    super(`Servicio ${serviceId} no encontrado en el catálogo`);
    this.name = "ServiceNotFoundError";
  }
}

// HU-07: lista completa de servicios (activos + inactivos) para resolver
// serviceId -> name en el panel técnico. El catálogo es pequeño (~10 items),
// no vale la pena un endpoint de bulk lookup específico.
export async function fetchAllServices(userToken: string): Promise<CatalogService[]> {
  const url = `${env.catalogServiceUrl}/services?includeInactive=true`;
  const response = await axios.get<{ services: CatalogService[] }>(url, {
    headers: { Authorization: `Bearer ${userToken}` },
    timeout: 5000,
  });
  return response.data.services ?? [];
}
