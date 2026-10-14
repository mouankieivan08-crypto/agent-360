// Interface commune entre l'agent et le canal de messagerie (WhatsApp ou simulateur console).

export type MediaKind = "audio" | "image" | "document";

export interface InboundMessage {
  id: string;
  /** Numéro international (chiffres) de l'interlocuteur, si connu. */
  phone: string | null;
  /** Message écrit dans la discussion « Moi (Vous) » du compte connecté. */
  isSelfChat: boolean;
  /** Envoyé depuis le compte connecté (ton téléphone), pas par l'interlocuteur. */
  fromMe: boolean;
  pushName: string | null;
  text: string;
  media: { kind: MediaKind; mimetype: string; fileName: string | null } | null;
  /** Télécharge le média à la demande (on ne télécharge rien pour les discussions privées ignorées). */
  download: (() => Promise<Buffer>) | null;
  timestamp: Date;
}

export interface OutreachStatus {
  /** WhatsApp a restreint ce compte pour les nouveaux contacts. */
  blocked: boolean;
  reason: string | null;
  /** Quota restant de nouvelles discussions, quand WhatsApp le communique. */
  newChatQuotaLeft: number | null;
}

export interface Transport {
  readonly name: string;
  start(onMessage: (msg: InboundMessage) => void): Promise<void>;
  isReady(): boolean;
  sendToOwner(text: string): Promise<void>;
  sendToPhone(phone: string, text: string): Promise<{ id: string }>;
  /** Le numéro a-t-il un compte WhatsApp ? */
  checkPhone(phone: string): Promise<boolean>;
  outreachStatus(): Promise<OutreachStatus>;
}
