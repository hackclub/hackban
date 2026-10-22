import { addDays, addMonths, addWeeks, addYears } from "date-fns";

export const RECURRENCES = ["daily", "weekdays", "weekly", "monthly", "yearly"] as const;
export type Recurrence = (typeof RECURRENCES)[number];

/**
 * The n-th occurrence after `due`. Months and years count from the original
 * date so Jan 31 -> Feb 28 -> Mar 31 instead of drifting to the 28th.
 */
function nth(due: Date, r: Recurrence, n: number, tzOffset: number): Date {
  switch (r) {
    case "daily":
      return addDays(due, n);
    case "weekly":
      return addWeeks(due, n);
    case "monthly":
      return addMonths(due, n);
    case "yearly":
      return addYears(due, n);
    case "weekdays": {
      let d = due;
      for (let i = 0; i < n; i++) {
        d = addDays(d, 1);
        // Weekend in the user's time zone, not the server's (UTC).
        while ([0, 6].includes(new Date(d.getTime() - tzOffset * 60_000).getUTCDay())) d = addDays(d, 1);
      }
      return d;
    }
  }
}

/**
 * Next occurrence strictly after `now`, stepping from the current due date
 * (so a card completed late doesn't land in the past). Capped so a bad date
 * can't loop forever. `tzOffset` is the user's `Date#getTimezoneOffset()`.
 */
export function nextDue(due: Date, r: Recurrence, now = new Date(), tzOffset = 0): Date {
  if (r === "weekdays") {
    // Step one weekday at a time from the last result (nth is O(n) here).
    let next = nth(due, r, 1, tzOffset);
    for (let i = 0; i < 5000 && next <= now; i++) next = nth(next, r, 1, tzOffset);
    return next;
  }
  let n = 1;
  while (n < 5000 && nth(due, r, n, tzOffset) <= now) n++;
  return nth(due, r, n, tzOffset);
}
