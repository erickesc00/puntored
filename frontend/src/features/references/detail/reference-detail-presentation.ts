import type { ReferenceAuditEntry, ReferenceSummary } from "@/features/references/shared/types";

export type FeedbackTone = "error" | "notice" | "status";

export interface FeedbackState {
  message: string;
  tone: FeedbackTone;
}

export const cancelConflictCodes = new Set([
  "REFERENCE_VERSION_CONFLICT",
  "INVALID_REFERENCE_STATE",
  "REFERENCE_EXPIRED",
]);

export const canCancelReference = (reference: ReferenceSummary) =>
  reference.status === "PENDING";

export const buildCancelConflictFeedback = (code: string): FeedbackState => {
  if (code === "REFERENCE_VERSION_CONFLICT") {
    return {
      tone: "notice",
      message:
        "La referencia cambió mientras confirmabas la cancelación. Ya refrescamos el detalle con la última versión para que revises el estado actual antes de intentarlo de nuevo.",
    };
  }

  if (code === "REFERENCE_EXPIRED") {
    return {
      tone: "notice",
      message:
        "La referencia venció antes de completar la cancelación. Ya actualizamos el detalle para mostrarte el estado efectivo.",
    };
  }

  return {
    tone: "notice",
    message:
      "La referencia cambió de estado antes de completar la cancelación. Ya refrescamos el detalle para que confirmes si todavía hace falta alguna acción.",
  };
};

export const formatHistoryTitle = (entry: ReferenceAuditEntry) =>
  `${entry.action.replaceAll("_", " ")} · ${entry.result.replaceAll("_", " ")}`;

export const formatActor = (entry: ReferenceAuditEntry) => {
  if (!entry.actorId) {
    return entry.actorType;
  }

  return `${entry.actorType} · ${entry.actorId}`;
};
