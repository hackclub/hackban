import { addDays, addMonths, addWeeks, addYears, isWeekend } from "date-fns";

export const RECURRENCES = ["daily", "weekdays", "weekly", "monthly", "yearly"] as const;
export type Recurrence = (typeof RECURRENCES)[number];

function step(d: Date, r: Recurrence): Date {
  switch (r) {
    case "daily":
      return addDays(d, 1);
    case "weekdays": {
      let n = addDays(d, 1);
      while (isWeekend(n)) n = addDays(n, 1);
      return n;
    }
    case "weekly":
      return addWeeks(d, 1);
    case "monthly":
      return addMonths(d, 1);
    case "yearly":
      return addYears(d, 1);
  }
}

/**
 * Next occurrence strictly after `now`, stepping from the current due date
 * (so a card completed late doesn't land in the past). Capped so a bad date
 * can't loop forever.
 */
export function nextDue(due: Date, r: Recurrence, now = new Date()): Date {
  let next = step(due, r);
  for (let i = 0; i < 5000 && next <= now; i++) next = step(next, r);
  return next;
}
