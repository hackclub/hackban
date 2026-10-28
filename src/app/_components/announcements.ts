// What's new in Hackban, newest first. Add an entry for every user-facing update or change.
// `id` must be unique; the header shows a dot until the viewer has seen the newest one.
export const ANNOUNCEMENTS: { id: string; date: string; title: string; body: string }[] = [
  { id: "card-dependencies", date: "2026-10-28", title: "Blocked cards", body: "Mark a card as blocked by another card from its Dependencies button: it gets a red Blocked badge and the blocker a yellow Blocking badge until the blocker is complete, which you can do right from the list." },
  { id: "slack-channel-join", date: "2026-10-28", title: "Join #hackban on Slack", body: "Logging in to Hackban for the first time adds you to the #hackban channel on the Hack Club Slack." },
  { id: "admin-imports", date: "2026-10-26", title: "Trello imports by admins", body: "Trello imports are now run by Hackban admins: ask in #hackban to get yours set up. The import link lives in your profile picture menu." },
  { id: "mcp-more-tools", date: "2026-10-26", title: "More MCP tools", body: "Connected apps can now invite members by email, edit boards and labels, copy cards, move lists, read activity and notifications, and restore archived items." },
  { id: "email-invites", date: "2026-10-26", title: "Invite by email", body: "Invite people to a workspace or board by email before they've logged in; they show as invited and join automatically when they first log in." },
  { id: "open-new-cards", date: "2026-10-26", title: "Open new cards right away", body: "A card you just created opens straight away instead of briefly saying it doesn't exist." },
  { id: "custom-avatars", date: "2026-10-26", title: "Custom profile pictures", body: "Upload your own profile picture (PNG, JPEG, GIF or WebP, up to 2 MB) from your profile page, or switch back to your Slack photo." },
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
