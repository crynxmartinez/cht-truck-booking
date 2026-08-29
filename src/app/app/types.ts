import type { Stage } from '@prisma/client';

/** Shapes shared between the board server component and its client children. */

export type CardData = {
  id: string;
  reference: string;
  stage: Stage;
  name: string;
  email: string;
  phone: string;
  truckCode: string | null;
  truckId: string | null;
  pickupLabel: string;
  returnLabel: string;
  pickupIso: string;
  returnIso: string;
  overdue: boolean;
  needsReview: boolean;
  rescheduleAsked: boolean;
  additionalDriver: boolean;
  createdLabel: string;
};

export type DocData = {
  id: string;
  kind: string;
  phase: string;
  url: string;
  isImage: boolean;
};

export type ContractData = {
  id: string;
  type: string;
  status: string;
  signerName: string | null;
  signedLabel: string;
  pdfUrl: string | null;
  link: string;
};

export type ChecklistData = {
  phase: string;
  submittedLabel: string;
  reportedTime: string | null;
  notes: string | null;
  link: string;
};

export type MessageData = {
  template: string;
  channel: string;
  status: string;
  sentLabel: string;
  error: string | null;
};

export type EventData = {
  type: string;
  detail: string | null;
  actor: string | null;
  atLabel: string;
};

export type BookingDetail = {
  card: CardData;
  reviewNote: string | null;
  additionalDriverName: string | null;
  additionalDriverContact: string | null;
  documents: DocData[];
  contracts: ContractData[];
  checklists: ChecklistData[];
  messages: MessageData[];
  events: EventData[];
};

export type TruckOption = { id: string; code: string };
