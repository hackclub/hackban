import {
  defaultShouldDehydrateQuery,
  MutationCache,
  QueryClient,
  type InvalidateOptions,
  type InvalidateQueryFilters,
  type QueryKey,
} from "@tanstack/react-query";
import SuperJSON from "superjson";

/**
 * tRPC query keys look like [["board", "get"], { input, type }]. Board and card
 * data is what optimistic card management edits, so it gets the sync gate.
 */
function isBoardData(key: QueryKey | undefined) {
  const path: unknown = key?.[0];
  if (!Array.isArray(path)) return false;
  const root: unknown = path[0];
  return root === "board" || root === "card";
}

/**
 * Seamless card management:
 * - A mutation starting cancels in-flight board/card refetches, so a stale
 *   response can't land on top of the optimistic state.
 * - While any mutation is in flight, board/card invalidations are queued and
 *   run once, together, after the last one settles. Two quick actions
 *   (complete, then move) can't make the card snap back and forth.
 * Every existing `utils.board.get.invalidate(...)` goes through this, so call
 * sites don't need to know about it.
 */
class SyncedQueryClient extends QueryClient {
  private deferred = new Map<string, InvalidateQueryFilters>();
  private holds = 0;

  override invalidateQueries(filters?: InvalidateQueryFilters, options?: InvalidateOptions) {
    if (filters && isBoardData(filters.queryKey) && (this.isMutating() > 0 || this.holds > 0)) {
      this.deferred.set(JSON.stringify(filters.queryKey), filters);
      return Promise.resolve();
    }
    return super.invalidateQueries(filters, options);
  }

  /** Run queued invalidations once nothing is mutating or holding. */
  flushDeferred() {
    if (this.isMutating() > 0 || this.holds > 0 || this.deferred.size === 0) return;
    const queued = [...this.deferred.values()];
    this.deferred.clear();
    for (const f of queued) void super.invalidateQueries(f);
  }

  /** Pause board refetches (e.g. during a drag); returns a release function. */
  hold() {
    this.holds++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holds--;
      this.flushDeferred();
    };
  }

  cancelBoardData() {
    return this.cancelQueries({ predicate: (q) => isBoardData(q.queryKey) });
  }
}

export type AppQueryClient = SyncedQueryClient;

export const createQueryClient = () => {
  const mutationCache = new MutationCache({
    onMutate: () => {
      void client.cancelBoardData();
    },
    onSettled: () => {
      // The settling mutation still counts as in flight here; check after.
      setTimeout(() => client.flushDeferred(), 0);
    },
  });
  const client: SyncedQueryClient = new SyncedQueryClient({
    mutationCache,
    defaultOptions: {
      queries: {
        // With SSR, we usually want to set some default staleTime
        // above 0 to avoid refetching immediately on the client
        staleTime: 30 * 1000,
      },
      dehydrate: {
        serializeData: SuperJSON.serialize,
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) ||
          query.state.status === "pending",
      },
      hydrate: {
        deserializeData: SuperJSON.deserialize,
      },
    },
  });
  return client;
};
