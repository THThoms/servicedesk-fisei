// Sprint 2 (rev) - Cliente HTTP hacia catalog-service para la base de conocimiento.
// Lo usa el endpoint POST /tickets/:id/resolve para:
//   - verificar que `knowledgeArticleId` existe (modo `existingKnowledge`),
//   - crear un nuevo artículo (modo `newKnowledge`).
// Comunicación interna por la red Docker (no pasa por el gateway).

import axios from "axios";
import { env } from "../config/env";

export interface KnowledgeArticleLite {
  id: string;
  title: string;
  problemDescription: string;
  solution: string;
  keywords: string[];
  service: { id: string; name: string } | null;
}

export interface CreateKnowledgePayload {
  title: string;
  problemDescription: string;
  solution: string;
  keywords: string[];
  serviceId?: string;
}

export class KnowledgeNotFoundError extends Error {
  constructor(id: string) {
    super(`Solución ${id} no encontrada en la base de conocimiento`);
    this.name = "KnowledgeNotFoundError";
  }
}

export class KnowledgeServiceError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = "KnowledgeServiceError";
  }
}

export async function fetchKnowledgeById(
  id: string,
  userToken: string
): Promise<KnowledgeArticleLite> {
  const url = `${env.catalogServiceUrl}/knowledge/${id}`;
  try {
    const response = await axios.get<{ article: KnowledgeArticleLite }>(url, {
      headers: { Authorization: `Bearer ${userToken}` },
      timeout: 5000,
    });
    return response.data.article;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      if (err.response?.status === 404) throw new KnowledgeNotFoundError(id);
      const msg =
        (err.response?.data as { error?: string } | undefined)?.error ?? err.message;
      throw new KnowledgeServiceError(msg, err.response?.status);
    }
    throw err;
  }
}

export async function createKnowledgeArticle(
  payload: CreateKnowledgePayload,
  userToken: string
): Promise<KnowledgeArticleLite> {
  const url = `${env.catalogServiceUrl}/knowledge`;
  try {
    const response = await axios.post<{ article: KnowledgeArticleLite }>(url, payload, {
      headers: { Authorization: `Bearer ${userToken}` },
      timeout: 5000,
    });
    return response.data.article;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const msg =
        (err.response?.data as { error?: string } | undefined)?.error ?? err.message;
      throw new KnowledgeServiceError(msg, err.response?.status);
    }
    throw err;
  }
}
