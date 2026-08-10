"use client";

import { ReferenceDetailContent } from "./reference-detail-content";
import { useReferenceDetailController } from "./use-reference-detail-controller";

export function ReferenceDetailView({ referenceId }: { referenceId: string }) {
  const controller = useReferenceDetailController(referenceId);

  return <ReferenceDetailContent controller={controller} />;
}
