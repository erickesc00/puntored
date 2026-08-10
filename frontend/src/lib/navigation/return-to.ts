const DEFAULT_RETURN_TO = '/references';

export const sanitizeReturnTo = (
  returnTo?: string | null,
  fallback = DEFAULT_RETURN_TO,
) => {
  if (!returnTo || !returnTo.startsWith('/') || returnTo.startsWith('//')) {
    return fallback;
  }

  return returnTo;
};

export const buildCurrentUrl = (
  pathname: string,
  searchParams: Pick<URLSearchParams, 'toString'>,
) => {
  const query = searchParams.toString();
  return query.length > 0 ? `${pathname}?${query}` : pathname;
};

export const buildHrefWithReturnTo = (pathname: string, returnTo: string) => {
  const params = new URLSearchParams({ returnTo });
  return `${pathname}?${params.toString()}`;
};

export { DEFAULT_RETURN_TO };
