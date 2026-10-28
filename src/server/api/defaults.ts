import { z } from "zod";

// Shared by routers and the Trello importer. Kept out of the routers so the importer
// (reached from auth via autojoin) doesn't import a router, which would be a cycle back into trpc.ts.
export const httpsUrl = z.string().max(2048).url().refine((u) => u.startsWith("https://"), "Must be an https URL");

export const DEFAULT_LABEL_COLORS = ["green", "yellow", "orange", "red", "purple", "blue"];
