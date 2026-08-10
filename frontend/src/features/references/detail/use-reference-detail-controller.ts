"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { cancelReference } from "@/features/references/cancel/api";
import type { ReferenceDetailResponse } from "@/features/references/shared/types";
import { ApiClientError } from "@/lib/api/errors";
import { buildCurrentUrl, sanitizeReturnTo } from "@/lib/navigation/return-to";
import { useSession } from "@/lib/session/session-provider";
import { fetchReferenceDetail } from "./api";
import {
  buildCancelConflictFeedback,
  canCancelReference,
  cancelConflictCodes,
  type FeedbackState,
} from "./reference-detail-presentation";

const detailErrorMessage = (error: ApiClientError) => {
  if (error.code === "REFERENCE_NOT_FOUND") {
    return "La referencia que buscas ya no existe o no está disponible.";
  }

  return "No pudimos cargar el detalle de la referencia. Inténtalo de nuevo.";
};

export interface ReferenceDetailController {
  canCancel: boolean;
  cancelDialogRef: RefObject<HTMLDivElement | null>;
  cancelDialogDismissButtonRef: RefObject<HTMLButtonElement | null>;
  cancelTriggerButtonRef: RefObject<HTMLButtonElement | null>;
  closeCancelConfirmation: () => void;
  confirmCancel: () => Promise<void>;
  detail: ReferenceDetailResponse | null;
  errorMessage: string | null;
  feedback: FeedbackState | null;
  isCancelling: boolean;
  isConfirmingCancel: boolean;
  isLoading: boolean;
  isNotFound: boolean;
  isSupervisor: boolean;
  onCancelDialogKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  openCancelConfirmation: () => void;
  reload: () => Promise<void>;
  returnTo: string;
}

export const useReferenceDetailController = (
  referenceId: string,
): ReferenceDetailController => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { handleSessionError, user } = useSession();
  const [detail, setDetail] = useState<ReferenceDetailResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isNotFound, setIsNotFound] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const cancelDialogRef = useRef<HTMLDivElement>(null);
  const cancelDialogDismissButtonRef = useRef<HTMLButtonElement>(null);
  const cancelTriggerButtonRef = useRef<HTMLButtonElement>(null);

  const currentUrl = useMemo(() => buildCurrentUrl(pathname, searchParams), [
    pathname,
    searchParams,
  ]);

  const returnTo = useMemo(
    () => sanitizeReturnTo(searchParams.get("returnTo")),
    [searchParams],
  );

  const restoreCancelTriggerFocus = useCallback(() => {
    window.requestAnimationFrame(() => {
      cancelTriggerButtonRef.current?.focus();
    });
  }, []);

  const closeCancelConfirmation = useCallback(() => {
    setIsConfirmingCancel(false);
    restoreCancelTriggerFocus();
  }, [restoreCancelTriggerFocus]);

  const loadDetail = useCallback(
    async (nextFeedback: FeedbackState | null = null) => {
      setIsLoading(true);
      setErrorMessage(null);
      setFeedback(nextFeedback);
      setIsNotFound(false);

      try {
        const response = await fetchReferenceDetail(referenceId);
        setDetail(response);
      } catch (error) {
        if (handleSessionError(error, currentUrl)) {
          return;
        }

        setDetail(null);
        setFeedback(null);

        if (
          error instanceof ApiClientError &&
          (error.statusCode === 404 || error.code === "REFERENCE_NOT_FOUND")
        ) {
          setIsNotFound(true);
          return;
        }

        setErrorMessage(
          error instanceof ApiClientError
            ? detailErrorMessage(error)
            : "No pudimos cargar el detalle de la referencia. Inténtalo de nuevo.",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [currentUrl, handleSessionError, referenceId],
  );

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    if (!isConfirmingCancel) {
      return;
    }

    cancelDialogDismissButtonRef.current?.focus();

    return undefined;
  }, [isCancelling, isConfirmingCancel]);

  const onCancelDialogKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape" && !isCancelling) {
        event.preventDefault();
        closeCancelConfirmation();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = cancelDialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );

      if (!focusableElements || focusableElements.length === 0) {
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
        return;
      }

      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    },
    [closeCancelConfirmation, isCancelling],
  );

  const isSupervisor = user?.role?.toUpperCase() === "SUPERVISOR";
  const canCancel = Boolean(
    detail && isSupervisor && canCancelReference(detail.reference),
  );

  return {
    canCancel,
    cancelDialogRef,
    cancelDialogDismissButtonRef,
    cancelTriggerButtonRef,
    closeCancelConfirmation,
    confirmCancel: async () => {
      if (!detail) {
        return;
      }

      setIsCancelling(true);

      try {
        await cancelReference(detail.reference.id, detail.reference.version);
        setIsConfirmingCancel(false);
        await loadDetail({
          tone: "status",
          message:
            "Referencia cancelada correctamente. Refrescamos el detalle con la última versión.",
        });
      } catch (error) {
        if (handleSessionError(error, currentUrl)) {
          return;
        }

        if (
          error instanceof ApiClientError &&
          error.statusCode === 409 &&
          cancelConflictCodes.has(error.code)
        ) {
          setIsConfirmingCancel(false);
          restoreCancelTriggerFocus();
          await loadDetail(buildCancelConflictFeedback(error.code));
          return;
        }

        setFeedback({
          tone: "error",
          message: "No pudimos cancelar la referencia. Inténtalo de nuevo.",
        });
      } finally {
        setIsCancelling(false);
      }
    },
    detail,
    errorMessage,
    feedback,
    isCancelling,
    isConfirmingCancel,
    isLoading,
    isNotFound,
    isSupervisor,
    onCancelDialogKeyDown,
    openCancelConfirmation: () => {
      setFeedback(null);
      setIsConfirmingCancel(true);
    },
    reload: async () => {
      await loadDetail();
    },
    returnTo,
  };
};
