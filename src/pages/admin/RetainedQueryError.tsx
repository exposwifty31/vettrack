import type { ReactNode } from "react";
import { ErrorCard } from "@/components/ui/error-card";

interface RetainedQueryErrorProps {
  isError: boolean;
  /** True once the query has ever succeeded (including an empty result). */
  hasCachedData: boolean;
  onRetry: () => unknown;
  children: ReactNode;
}

/**
 * Fatal ErrorCard only when there is nothing to show. A refetch / next-page
 * failure keeps `children` on screen and puts retry next to it.
 */
export function RetainedQueryError({
  isError,
  hasCachedData,
  onRetry,
  children,
}: RetainedQueryErrorProps) {
  if (isError && !hasCachedData) {
    return <ErrorCard onRetry={onRetry} />;
  }
  return (
    <>
      {isError ? <ErrorCard onRetry={onRetry} /> : null}
      {children}
    </>
  );
}
