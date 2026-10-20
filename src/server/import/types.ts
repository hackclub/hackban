// The subset of Trello's board JSON we use. A board JSON export and the
// REST API (`/1/boards/:id?...`) return the same shape, so both import
// sources feed this one type.

export type TrelloLabel = { id: string; name: string; color: string | null };
export type TrelloList = { id: string; name: string; closed: boolean; pos: number };
export type TrelloAttachment = {
  id: string;
  name: string;
  url: string;
  mimeType?: string | null;
  bytes?: number | null;
  date?: string;
  isUpload?: boolean;
  idMember?: string | null;
};
export type TrelloCard = {
  id: string;
  name: string;
  desc: string;
  closed: boolean;
  idList: string;
  pos: number;
  due: string | null;
  start?: string | null;
  dueComplete: boolean;
  idLabels: string[];
  idMembers: string[];
  idShort?: number;
  dateLastActivity?: string;
  cover?: { color?: string | null; idAttachment?: string | null; size?: "normal" | "full" } | null;
  attachments?: TrelloAttachment[];
};
export type TrelloChecklist = {
  id: string;
  idCard: string;
  name: string;
  pos: number;
  checkItems: {
    id: string;
    name: string;
    pos: number;
    state: "complete" | "incomplete";
    due?: string | null;
    idMember?: string | null;
  }[];
};
export type TrelloMember = {
  id: string;
  fullName: string;
  username: string;
  avatarUrl?: string | null;
};
export type TrelloAction = {
  id: string;
  type: string;
  date: string;
  idMemberCreator: string;
  memberCreator?: TrelloMember;
  data: { text?: string; card?: { id: string } };
};
export type TrelloBoard = {
  id: string;
  name: string;
  desc: string;
  closed: boolean;
  idOrganization?: string | null;
  prefs?: {
    permissionLevel?: string;
    backgroundColor?: string | null;
    backgroundImage?: string | null;
    backgroundBottomColor?: string | null;
    backgroundTopColor?: string | null;
    backgroundImageScaled?: { width: number; height: number; url: string }[] | null;
  };
  labels: TrelloLabel[];
  lists: TrelloList[];
  cards: TrelloCard[];
  checklists: TrelloChecklist[];
  members: TrelloMember[];
  actions?: TrelloAction[];
};
