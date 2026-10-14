// Aiguillage des messages entrants : le propriétaire parle à l'agent, les prospects du CRM
// sont suivis, et TOUT le reste (famille, amis, groupes) est ignoré sans être lu ni stocké.

import type { Agent } from "./agent.ts";
import type { Config } from "./config.ts";
import type { Prospect, Store } from "./db.ts";
import type { Attachment } from "./prompt.ts";
import { isOptOut, truncate } from "./text.ts";
import type { Transcriber } from "./transcribe.ts";
import type { InboundMessage, Transport } from "./transport/types.ts";

const OWNER_DEBOUNCE_MS = 2500;
const PROSPECT_DEBOUNCE_MS = 45_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_FILE_CHARS = 60_000;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

interface Pending<T> {
  parts: string[];
  extra: T[];
  timer: NodeJS.Timeout | null;
}

export class Router {
  private owner: Pending<Attachment> = { parts: [], extra: [], timer: null };
  private prospects = new Map<number, Pending<never>>();

  constructor(
    private readonly store: Store,
    private readonly cfg: Config,
    private readonly transport: Transport,
    private readonly agent: Agent,
    private readonly transcribe: Transcriber | null,
  ) {}

  onMessage = (m: InboundMessage): void => {
    this.dispatch(m).catch((e) => console.error("Erreur de routage :", e));
  };

  private isOwner(m: InboundMessage): boolean {
    if (m.isSelfChat) return true;
    return !m.fromMe && !!m.phone && this.cfg.ownerNumbers.includes(m.phone);
  }

  private async dispatch(m: InboundMessage): Promise<void> {
    if (this.isOwner(m)) return this.fromOwner(m);
    if (!m.phone) return;
    const prospect = this.store.findProspectByPhone(m.phone);
    if (!prospect) return; // discussion privée : on n'y touche pas

    if (m.fromMe) {
      // Message envoyé à la main depuis ton téléphone : on garde le CRM à jour.
      const body = m.text || (m.media ? `[${m.media.kind} envoyé]` : "");
      if (!body) return;
      this.store.logMessage({ prospectId: prospect.id, direction: "out", body, waId: m.id });
      if (prospect.status === "new" || prospect.status === "queued") {
        this.store.updateProspect(prospect.id, { status: "contacted" });
      }
      return;
    }
    return this.fromProspect(prospect, m);
  }

  private async fromOwner(m: InboundMessage): Promise<void> {
    const text = m.text.trim();
    if (/^\/pause\b/i.test(text)) return this.pauseAll();

    let part = text;
    if (m.media && m.download) {
      try {
        const data = await m.download();
        part = await this.ownerMedia(m, data, part);
      } catch (e) {
        console.error("Téléchargement du média impossible :", e);
        part = `${part}\n[pièce jointe ${m.media.kind} illisible]`.trim();
      }
    }
    if (!part && !this.owner.extra.length) return;
    if (part) this.owner.parts.push(part);
    if (this.owner.timer) clearTimeout(this.owner.timer);
    this.owner.timer = setTimeout(() => {
      const ev = { type: "message_proprietaire" as const, text: this.owner.parts.join("\n"), attachments: this.owner.extra };
      this.owner = { parts: [], extra: [], timer: null };
      this.agent.handle(ev).catch((e) => console.error(e));
    }, OWNER_DEBOUNCE_MS);
  }

  private async ownerMedia(m: InboundMessage, data: Buffer, caption: string): Promise<string> {
    const media = m.media!;
    if (media.kind === "audio") {
      if (!this.transcribe) {
        return "[Note vocale reçue, mais la transcription n'est pas configurée (STT_API_KEY). Demande-lui d'écrire ou de configurer la transcription.]";
      }
      const t = await this.transcribe(data, media.mimetype);
      return t ? `🎤 (note vocale retranscrite) ${t}` : "[Note vocale reçue mais la transcription a échoué]";
    }
    const mime = media.mimetype.split(";")[0]?.trim().toLowerCase() ?? "";
    if (media.kind === "image") {
      const mediaType = IMAGE_TYPES.find((t) => t === mime);
      if (!mediaType || data.length > MAX_IMAGE_BYTES) return `${caption}\n[image non prise en charge ou trop lourde]`.trim();
      this.owner.extra.push({ kind: "image", mediaType, base64: data.toString("base64") });
      return caption || "[image envoyée]";
    }
    // Document
    const name = media.fileName ?? "document";
    if (mime === "application/pdf") {
      this.owner.extra.push({ kind: "pdf", base64: data.toString("base64") });
      return `${caption}\n[PDF joint : ${name}]`.trim();
    }
    if (mime.startsWith("text/") || /\.(csv|txt|json|tsv)$/i.test(name)) {
      const content = truncate(data.toString("utf8"), MAX_TEXT_FILE_CHARS);
      return `${caption}\n<fichier nom="${name}">\n${content}\n</fichier>`.trim();
    }
    return `${caption}\n[Fichier « ${name} » (${mime}) non lisible : envoie un CSV, un PDF ou une capture d'écran]`.trim();
  }

  private async fromProspect(p: Prospect, m: InboundMessage): Promise<void> {
    let body = m.text.trim();
    if (m.media?.kind === "audio") {
      let t: string | null = null;
      if (this.transcribe && m.download) t = await this.transcribe(await m.download(), m.media.mimetype).catch(() => null);
      body = t ? `🎤 ${t}` : "[note vocale non retranscrite]";
    } else if (m.media) {
      body = `[${m.media.kind}${m.media.fileName ? ` ${m.media.fileName}` : ""}] ${body}`.trim();
    }
    if (!body) return;

    this.store.logMessage({ prospectId: p.id, direction: "in", body, waId: m.id });
    if (isOptOut(body)) {
      this.store.updateProspect(p.id, { status: "do_not_contact" });
      this.store.cancelQueuedForProspect(p.id, "désinscription");
      this.store.appendProspectNote(p.id, "A demandé à ne plus être contacté (désinscription automatique).");
      body += "\n(Système : désinscription détectée et appliquée, plus aucun message ne lui sera envoyé.)";
    } else if (["new", "queued", "contacted"].includes(p.status)) {
      this.store.updateProspect(p.id, { status: "replied" });
      // Il a répondu : on n'envoie plus de relance automatique prévue.
      this.store.cancelQueuedForProspect(p.id, "a répondu");
    }

    const pending = this.prospects.get(p.id) ?? { parts: [], extra: [], timer: null };
    pending.parts.push(body);
    if (pending.timer) clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      this.prospects.delete(p.id);
      this.agent
        .handle({ type: "reponse_prospect", prospectId: p.id, text: pending.parts.join("\n"), newMessages: pending.parts.length })
        .catch((e) => console.error(e));
    }, PROSPECT_DEBOUNCE_MS);
    this.prospects.set(p.id, pending);
  }

  private async pauseAll(): Promise<void> {
    const running = this.store.listCampaigns(100).filter((c) => c.status === "running");
    for (const c of running) this.store.setCampaignStatus(c.id, "paused");
    const msg = running.length
      ? `⏸️ ${running.length} campagne(s) en pause : ${running.map((c) => `#${c.id} ${c.name}`).join(", ")}. Dis-moi quand reprendre.`
      : "Aucune campagne en cours d'envoi.";
    this.store.addOwnerChat("owner", "/pause");
    this.store.addOwnerChat("agent", msg);
    await this.transport.sendToOwner(msg);
  }
}
