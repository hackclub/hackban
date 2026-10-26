// What's new in Hackban, newest first. Add an entry for every user-facing update or change.
// `id` must be unique; the header shows a dot until the viewer has seen the newest one.
export const ANNOUNCEMENTS: { id: string; date: string; title: string; body: string }[] = [
  { id: "list-colors", date: "2026-10-26", title: "List colors", body: "Give a list a color from its ⋯ menu, and typing in a list's name no longer drags the list around." },
  { id: "announcements", date: "2026-10-24", title: "What's new in Hackban", body: "This megaphone now lists updates and changes as they ship." },
  { id: "sort-lists", date: "2026-10-24", title: "Sort lists", body: "Sort a list's cards by due date, name, age, or member count with the new sort button on each list." },
  { id: "mcp", date: "2026-10-23", title: "Hackban MCP", body: "Connect Claude or other MCP clients to your boards: search, create and move cards, comment, and more." },
  { id: "faster-cards", date: "2026-10-23", title: "Faster cards", body: "Cards open faster, and you can scroll a list with your mouse wheel while dragging a card." },
  { id: "dates", date: "2026-10-22", title: "Better date assignments", body: "New due dates default to the time you picked last." },
  { id: "instant-edits", date: "2026-10-21", title: "Instant edits", body: "Assigning members, dates and labels updates everywhere instantly, and new cards offer an 'Assign to you?' nudge." },
  { id: "repeat", date: "2026-10-20", title: "Repeating cards", body: "Cards can repeat on a schedule, Trello-style, with a little confetti when you complete them." },
  { id: "guests", date: "2026-10-20", title: "Board guests and invite links", body: "Invite people to a single board with a link, without adding them to the whole workspace." },
];
