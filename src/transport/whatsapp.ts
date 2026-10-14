// Connexion WhatsApp via Baileys (appareil lié, comme WhatsApp Web).
// ⚠️ API non officielle : respecte les limites d'envoi, sinon WhatsApp peut restreindre le numéro.

import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  generateMessageIDV2,
  isJidBroadcast,
  isJidGroup,
  isLidUser,
  isPnUser,
  jidDecode,
  jidNormalizedUser,
  normalizeMessageContent,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
  type proto,
} from "@whiskeysockets/baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import type { Config } from "../config.ts";
import type { InboundMessage, OutreachStatus, Transport } from "./types.ts";

const logger = pino({ level: process.env.WA_LOG_LEVEL ?? "warn" });
const MAX_OFFLINE_AGE_MS = 12 * 3600_000;

/** Horodatage WhatsApp (nombre ou entier « Long » protobuf) en millisecondes. */
function timestampMs(v: unknown): number {
  if (typeof v === "number") return v * 1000;
  if (v && typeof (v as { toNumber?: unknown }).toNumber === "function") return (v as { toNumber(): number }).toNumber() * 1000;
  return Date.now();
}

export class WhatsAppTransport implements Transport {
  readonly name = "whatsapp";
  private sock: WASocket | null = null;
  private ready = false;
  private onMessage: ((m: InboundMessage) => void) | null = null;
  /** Identifiants des messages envoyés par l'agent : on ne les retraite jamais (évite les boucles). */
  private readonly sentIds = new Set<string>();
  /** Messages déjà traités (WhatsApp peut renvoyer le même événement). */
  private readonly seenIds = new Set<string>();
  /** Copie des messages envoyés, demandée par WhatsApp en cas de renvoi. */
  private readonly sentCache = new Map<string, proto.IMessage>();
  private pairingRequested = false;
  private retries = 0;
  private newChatQuota: { total?: number; used?: number } = {};

  constructor(private readonly cfg: Config) {}

  isReady(): boolean {
    return this.ready;
  }

  async start(onMessage: (m: InboundMessage) => void): Promise<void> {
    this.onMessage = onMessage;
    await this.connect();
  }

  private async connect(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.cfg.authDir);
    let version: [number, number, number] | undefined;
    try {
      version = (await fetchLatestBaileysVersion()).version;
    } catch {
      version = undefined; // version embarquée par défaut
    }

    const sock = makeWASocket({
      auth: state,
      version,
      logger,
      browser: Browsers.ubuntu("Chrome"),
      // Important : garde les notifications sur ton téléphone.
      markOnlineOnConnect: false,
      syncFullHistory: false,
      getMessage: async (key) => (key.id ? this.sentCache.get(key.id) : undefined),
    });
    this.sock = sock;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (u) => {
      if (u.qr) {
        if (this.cfg.pairingNumber && !state.creds.registered && !this.pairingRequested) {
          this.pairingRequested = true;
          try {
            const code = await sock.requestPairingCode(this.cfg.pairingNumber);
            console.log(
              `\n🔗 Code d'appairage : ${code}\nWhatsApp > Appareils connectés > Connecter un appareil > « Connecter avec un numéro de téléphone ».\n`,
            );
          } catch (e) {
            console.error("Impossible d'obtenir le code d'appairage, scanne le QR code :", e);
            qrcode.generate(u.qr, { small: true });
          }
        } else if (!this.cfg.pairingNumber) {
          console.log("\n📱 Scanne ce QR code : WhatsApp > Appareils connectés > Connecter un appareil\n");
          qrcode.generate(u.qr, { small: true });
        }
      }
      if (u.reachoutTimeLock?.isActive) {
        console.warn("⚠️ WhatsApp limite actuellement ce compte pour contacter de nouvelles personnes.");
      }
      if (u.connection === "open") {
        this.ready = true;
        this.retries = 0;
        console.log(`✅ WhatsApp connecté (${jidNormalizedUser(sock.user?.id)})`);
      }
      if (u.connection === "close") {
        this.ready = false;
        const code = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          console.error(
            `❌ Session WhatsApp déconnectée. Supprime le dossier « ${this.cfg.authDir} » puis relance pour rescanner.`,
          );
          return;
        }
        // Reconnexion progressive : 3 s, 6 s, 12 s... jusqu'à 2 min (coupure réseau, etc.).
        const delay = code === DisconnectReason.restartRequired ? 0 : Math.min(120_000, 3000 * 2 ** this.retries++);
        if (this.retries === 4) console.warn("WhatsApp injoignable, nouvelles tentatives en cours…");
        setTimeout(() => {
          this.connect().catch((e) => console.error("Reconnexion WhatsApp échouée :", e));
        }, delay);
      }
    });

    sock.ev.on("message-capping.update", (info) => {
      this.newChatQuota = { total: info.total_quota, used: info.used_quota };
    });

    sock.ev.on("messages.upsert", ({ messages, type }) => {
      for (const msg of messages) {
        // « append » = messages reçus pendant que l'agent était hors ligne (ou nos propres envois,
        // filtrés plus loin) : on ne rattrape que les 12 dernières heures.
        if (type === "append" && Date.now() - timestampMs(msg.messageTimestamp) > MAX_OFFLINE_AGE_MS) continue;
        const id = msg.key.id;
        if (!id || this.seenIds.has(id)) continue;
        this.seenIds.add(id);
        if (this.seenIds.size > 5000) this.seenIds.delete(this.seenIds.values().next().value as string);
        this.toInbound(msg)
          .then((m) => {
            if (m) this.onMessage?.(m);
          })
          .catch((e) => console.error("Message entrant illisible :", e));
      }
    });
  }

  private ownJids(): string[] {
    const me = this.sock?.user;
    return [me?.id, me?.lid].filter((j): j is string => !!j).map((j) => jidNormalizedUser(j));
  }

  private async phoneOf(jid: string, alt: string | undefined): Promise<string | null> {
    let pn: string | null = null;
    if (isPnUser(jid)) pn = jid;
    else if (alt && isPnUser(alt)) pn = alt;
    else if (isLidUser(jid) && this.sock) {
      pn = await this.sock.signalRepository.lidMapping.getPNForLID(jid).catch(() => null);
    }
    return pn ? (jidDecode(pn)?.user ?? null) : null;
  }

  private async toInbound(msg: WAMessage): Promise<InboundMessage | null> {
    const jid = msg.key.remoteJid;
    const id = msg.key.id;
    if (!jid || !id || !msg.message) return null;
    if (this.sentIds.has(id)) return null;
    if (isJidGroup(jid) || isJidBroadcast(jid) || jid.endsWith("@newsletter")) return null;

    const content = normalizeMessageContent(msg.message);
    if (!content) return null;

    const isSelfChat = this.ownJids().includes(jidNormalizedUser(jid));
    const phone = isSelfChat ? null : await this.phoneOf(jid, msg.key.remoteJidAlt);

    let text =
      content.conversation ??
      content.extendedTextMessage?.text ??
      content.imageMessage?.caption ??
      content.videoMessage?.caption ??
      content.documentMessage?.caption ??
      "";
    let media: InboundMessage["media"] = null;
    if (content.audioMessage) {
      media = { kind: "audio", mimetype: content.audioMessage.mimetype ?? "audio/ogg", fileName: null };
    } else if (content.imageMessage) {
      media = { kind: "image", mimetype: content.imageMessage.mimetype ?? "image/jpeg", fileName: null };
    } else if (content.documentMessage) {
      media = {
        kind: "document",
        mimetype: content.documentMessage.mimetype ?? "application/octet-stream",
        fileName: content.documentMessage.fileName ?? null,
      };
    }
    if (!text && !media) {
      if (content.reactionMessage || content.protocolMessage || content.senderKeyDistributionMessage) return null;
      text = "[message non pris en charge : sticker, vidéo, contact ou localisation]";
    }

    const sock = this.sock;
    return {
      id,
      phone,
      isSelfChat,
      fromMe: !!msg.key.fromMe,
      pushName: msg.pushName ?? null,
      text,
      media,
      download:
        media && sock
          ? () =>
              downloadMediaMessage(msg, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage })
          : null,
      timestamp: new Date(timestampMs(msg.messageTimestamp)),
    };
  }

  private ownerJid(): string {
    const owner = this.cfg.ownerNumbers[0];
    if (owner) return `${owner}@s.whatsapp.net`;
    const self = this.sock?.user?.id;
    if (!self) throw new Error("WhatsApp non connecté");
    return jidNormalizedUser(self);
  }

  private async send(jid: string, text: string): Promise<string> {
    const sock = this.sock;
    if (!sock || !this.ready) throw new Error("WhatsApp non connecté");
    const messageId = generateMessageIDV2(sock.user?.id);
    this.sentIds.add(messageId);
    if (this.sentIds.size > 2000) this.sentIds.delete(this.sentIds.values().next().value as string);
    const sent = await sock.sendMessage(jid, { text }, { messageId });
    if (sent?.message) {
      this.sentCache.set(messageId, sent.message);
      if (this.sentCache.size > 500) this.sentCache.delete(this.sentCache.keys().next().value as string);
    }
    return messageId;
  }

  async sendToOwner(text: string): Promise<void> {
    await this.send(this.ownerJid(), text);
  }

  async sendToPhone(phone: string, text: string): Promise<{ id: string }> {
    const jid = `${phone}@s.whatsapp.net`;
    const sock = this.sock;
    if (sock && this.ready) {
      // Comportement humain : « en train d'écrire… » quelques secondes avant l'envoi.
      await sock.sendPresenceUpdate("composing", jid).catch(() => undefined);
      await new Promise((r) => setTimeout(r, Math.min(8000, 1500 + text.length * 25)));
      await sock.sendPresenceUpdate("paused", jid).catch(() => undefined);
    }
    return { id: await this.send(jid, text) };
  }

  async checkPhone(phone: string): Promise<boolean> {
    if (!this.sock || !this.ready) throw new Error("WhatsApp non connecté");
    const r = await this.sock.onWhatsApp(phone);
    return !!r?.[0]?.exists;
  }

  async outreachStatus(): Promise<OutreachStatus> {
    const sock = this.sock;
    if (!sock || !this.ready) return { blocked: true, reason: "WhatsApp non connecté", newChatQuotaLeft: null };
    try {
      const lock = await sock.fetchAccountReachoutTimelock();
      if (lock.isActive) {
        const until = lock.timeEnforcementEnds ? ` jusqu'au ${lock.timeEnforcementEnds.toLocaleString("fr-FR")}` : "";
        return {
          blocked: true,
          reason: `WhatsApp restreint ce compte pour les nouveaux contacts${until} (${lock.enforcementType ?? "?"})`,
          newChatQuotaLeft: 0,
        };
      }
    } catch {
      // Information indisponible : on continue avec les limites locales.
    }
    try {
      const cap = (await sock.fetchNewChatMessageCap()) as { total_quota?: number; used_quota?: number } | undefined;
      if (cap) this.newChatQuota = { total: cap.total_quota, used: cap.used_quota };
    } catch {
      // idem
    }
    const { total, used } = this.newChatQuota;
    const left = typeof total === "number" && typeof used === "number" ? Math.max(0, total - used) : null;
    return {
      blocked: left === 0,
      reason: left === 0 ? "Quota WhatsApp de nouvelles discussions épuisé pour la période" : null,
      newChatQuotaLeft: left,
    };
  }
}
