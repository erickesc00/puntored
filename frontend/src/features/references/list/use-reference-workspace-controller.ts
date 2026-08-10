"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ApiClientError } from "@/lib/api/errors";
import {
  buildCurrentUrl,
  buildHrefWithReturnTo,
} from "@/lib/navigation/return-to";
import { useSession } from "@/lib/session/session-provider";
import type { ReferenceSummary, ReferenceStatus } from "@/features/references/shared/types";
import { fetchReferenceList } from "./api";
import {
  buildReferenceListSearchParams,
  createInitialReferenceListState,
  getNextReferenceListState,
  getPreviousReferenceListState,
  getReferenceListPage,
  parseReferenceListUrlState,
  type ReferenceListUrlState,
} from "./query-state";

const listErrorMessage = (error: ApiClientError) => {
  if (error.code === "INVALID_CURSOR") {
    return "La página que abriste dejó de ser válida. Puedes volver al inicio del listado con los filtros actuales o reintentar la carga.";
  }

  return "No pudimos cargar las referencias. Inténtalo de nuevo.";
};

export interface ReferenceWorkspaceController {
  createdId: string | null;
  currentUrl: string;
  draftState: ReferenceListUrlState;
  errorCode: string | null;
  errorMessage: string | null;
  hasActiveFilters: boolean;
  isLoading: boolean;
  items: ReferenceSummary[];
  nextCursor: string | null;
  page: number;
  previousPageDisabled: boolean;
  previousState: ReferenceListUrlState | null;
  setCreatedFrom: (value: string) => void;
  setCreatedTo: (value: string) => void;
  setLimit: (value: number) => void;
  setSearch: (value: string) => void;
  setStatus: (value: ReferenceStatus | null) => void;
  submitFilters: () => void;
  resetFilters: () => void;
  resetPagination: () => void;
  retry: () => void;
  goToPreviousPage: () => void;
  goToNextPage: () => void;
  buildDetailHref: (referenceId: string) => string;
}

export const useReferenceWorkspaceController = (): ReferenceWorkspaceController => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { handleSessionError } = useSession();

  const currentUrl = useMemo(() => buildCurrentUrl(pathname, searchParams), [
    pathname,
    searchParams,
  ]);

  const urlState = useMemo(
    () => parseReferenceListUrlState(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const [draftState, setDraftState] = useState<ReferenceListUrlState>(urlState);
  const [items, setItems] = useState<ReferenceSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    setDraftState(urlState);
  }, [urlState]);

  useEffect(() => {
    let cancelled = false;

    setIsLoading(true);
    setErrorCode(null);
    setErrorMessage(null);

    void fetchReferenceList(urlState)
      .then((response) => {
        if (cancelled) {
          return;
        }

        setItems(response.items);
        setNextCursor(response.pageInfo.nextCursor);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        if (handleSessionError(error, currentUrl)) {
          return;
        }

        setItems([]);
        setNextCursor(null);
        setErrorCode(error instanceof ApiClientError ? error.code : null);
        setErrorMessage(
          error instanceof ApiClientError
            ? listErrorMessage(error)
            : "No pudimos cargar las referencias. Inténtalo de nuevo.",
        );
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentUrl, handleSessionError, retryNonce, urlState]);

  const updateUrl = (nextState: ReferenceListUrlState) => {
    const query = buildReferenceListSearchParams(nextState).toString();
    router.push(query.length > 0 ? `${pathname}?${query}` : pathname);
  };

  const previousState = getPreviousReferenceListState(urlState);

  return {
    createdId: searchParams.get("created"),
    currentUrl,
    draftState,
    errorCode,
    errorMessage,
    hasActiveFilters: Boolean(
      urlState.search ||
        urlState.status ||
        urlState.createdFrom ||
        urlState.createdTo,
    ),
    isLoading,
    items,
    nextCursor,
    page: getReferenceListPage(urlState),
    previousPageDisabled: !previousState || isLoading,
    previousState,
    setCreatedFrom: (value) => {
      setDraftState((current) => ({ ...current, createdFrom: value }));
    },
    setCreatedTo: (value) => {
      setDraftState((current) => ({ ...current, createdTo: value }));
    },
    setLimit: (value) => {
      setDraftState((current) => ({ ...current, limit: value }));
    },
    setSearch: (value) => {
      setDraftState((current) => ({ ...current, search: value }));
    },
    setStatus: (value) => {
      setDraftState((current) => ({ ...current, status: value }));
    },
    submitFilters: () => {
      updateUrl({
        ...draftState,
        search: draftState.search.trim(),
        cursor: null,
        trail: [],
      });
    },
    resetFilters: () => {
      const nextState = createInitialReferenceListState();
      setDraftState(nextState);
      updateUrl(nextState);
    },
    resetPagination: () => {
      updateUrl({
        ...urlState,
        cursor: null,
        trail: [],
      });
    },
    retry: () => {
      setRetryNonce((current) => current + 1);
    },
    goToPreviousPage: () => {
      if (previousState) {
        updateUrl(previousState);
      }
    },
    goToNextPage: () => {
      if (nextCursor) {
        updateUrl(getNextReferenceListState(urlState, nextCursor));
      }
    },
    buildDetailHref: (referenceId: string) =>
      buildHrefWithReturnTo(`/references/${referenceId}`, currentUrl),
  };
};
