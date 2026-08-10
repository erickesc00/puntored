"use client";

import { ReferenceWorkspaceView } from "./reference-workspace-view";
import { useReferenceWorkspaceController } from "./use-reference-workspace-controller";

export function ReferenceWorkspace() {
  const controller = useReferenceWorkspaceController();

  return <ReferenceWorkspaceView controller={controller} />;
}
