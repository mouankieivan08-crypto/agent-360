// Cerveau de l'agent : une boucle Claude + outils par événement (message du propriétaire,
// réponse d'un prospect, rituel, rappel). Chaque tour repart d'un contexte frais construit
// depuis le CRM : l'historique n'est jamais réécrit et le préfixe (outils + prompt) reste en cache.

import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { type AgentEvent, buildContext, renderEvent, renderHistory, systemPrompt } from "./prompt.ts";
import { splitForWhatsApp, truncate } from "./text.ts";
import { runTool, serverTools, TOOLS } from "./tools.ts";
import type { Transport } from "./transport/types.ts";

type CreateParams = Anthropic.Beta.MessageCreateParamsNonStreaming;
export interface MessagesApi {
  create(params: CreateParams): Promise<Anthropic.Beta.BetaMessage>;
}

const MAX_STEPS = 15;
const SILENT = "RIEN";

export class Agent {
  private queue: Promise<void> = Promise.resolve();
  private readonly system: string;
  private readonly tools: Anthropic.Beta.BetaToolUnion[];

  constructor(
    private readonly store: Store,
    private readonly cfg: Config,
    private readonly transport: Transport,
    private readonly api: MessagesApi = new Anthropic().beta.messages,
  ) {
    this.system = systemPrompt(cfg);
    this.tools = [...TOOLS, ...serverTools(cfg)];
  }

  /** Traite les événements un par un, dans l'ordre d'arrivée. */
  handle(ev: AgentEvent): Promise<void> {
    const next = this.queue.then(() => this.run(ev));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async run(ev: AgentEvent): Promise<void> {
    const now = new Date();
    const userText = [
      `<contexte>\n${buildContext(this.store, this.cfg, now)}\n</contexte>`,
      `<historique_recent>\n${renderHistory(this.store, this.cfg)}\n</historique_recent>`,
      renderEvent(this.store, ev),
    ].join("\n\n");
    this.logIncoming(ev);

    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (ev.type === "message_proprietaire") {
      for (const a of ev.attachments ?? []) {
        content.push(
          a.kind === "image"
            ? { type: "image", source: { type: "base64", media_type: a.mediaType, data: a.base64 } }
            : { type: "document", source: { type: "base64", media_type: "application/pdf", data: a.base64 } },
        );
      }
    }
    content.push({ type: "text", text: userText });

    let reply: string;
    try {
      reply = await this.loop([{ role: "user", content }], ev.type === "message_proprietaire", now);
    } catch (e) {
      console.error("Erreur agent :", e instanceof Anthropic.APIError ? e.message : e);
      if (ev.type !== "message_proprietaire") return;
      reply =
        e instanceof Anthropic.RateLimitError
          ? "Je suis momentanément saturé (limite de l'API). Réessaie dans une minute."
          : e instanceof Anthropic.AuthenticationError
            ? "Ma clé API Claude est invalide : vérifie ANTHROPIC_API_KEY dans le fichier .env."
            : "Petit souci technique de mon côté, je n'ai pas pu traiter ton message. Réessaie dans un instant.";
    }

    reply = reply.trim();
    if (!reply || (reply === SILENT && ev.type !== "message_proprietaire")) return;
    if (reply === SILENT) reply = "👍";
    for (const part of splitForWhatsApp(reply)) await this.transport.sendToOwner(part);
    this.store.addOwnerChat("agent", reply);
  }

  private logIncoming(ev: AgentEvent): void {
    switch (ev.type) {
      case "message_proprietaire": {
        const n = ev.attachments?.length ?? 0;
        this.store.addOwnerChat("owner", n ? `${ev.text} [${n} pièce(s) jointe(s)]` : ev.text);
        break;
      }
      case "reponse_prospect": {
        const p = this.store.getProspect(ev.prospectId);
        this.store.addOwnerChat("event", `Réponse du prospect #${ev.prospectId} ${p?.company ?? ""} : ${truncate(ev.text, 300)}`);
        break;
      }
      case "rappel":
        this.store.addOwnerChat("event", `Rappel : ${ev.text}`);
        break;
      case "alerte":
        this.store.addOwnerChat("event", `Alerte : ${ev.text}`);
        break;
      default:
        this.store.addOwnerChat("event", ev.type.replaceAll("_", " "));
    }
  }

  private async loop(messages: Anthropic.Beta.BetaMessageParam[], ownerTurn: boolean, now: Date): Promise<string> {
    const useFallback = !this.cfg.model.includes("haiku");
    for (let step = 0; step < MAX_STEPS; step++) {
      const response = await this.api.create({
        model: this.cfg.model,
        max_tokens: 16000,
        // Préfixe stable (outils + prompt système) mis en cache ; la suite du tour est mise en cache automatiquement.
        system: [{ type: "text", text: this.system, cache_control: { type: "ephemeral" } }],
        cache_control: { type: "ephemeral" },
        tools: this.tools,
        messages,
        thinking: { type: "adaptive" },
        output_config: { effort: this.cfg.effort },
        // En cas de refus des filtres de sécurité, l'API relance la requête sur un autre modèle.
        ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });
      const u = response.usage;
      console.log(
        `[claude] ${response.model} stop=${response.stop_reason} in=${u.input_tokens} cache_read=${u.cache_read_input_tokens ?? 0} out=${u.output_tokens}`,
      );

      if (response.stop_reason === "refusal") {
        return "Je ne peux pas traiter cette demande telle quelle. Reformule-la autrement ?";
      }
      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason === "pause_turn") continue;

      const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (response.stop_reason !== "tool_use" || !toolUses.length) {
        return response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
      }

      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const call of toolUses) {
        const input = (call.input && typeof call.input === "object" ? call.input : {}) as Record<string, unknown>;
        try {
          const out = await runTool(call.name, input, { store: this.store, cfg: this.cfg, transport: this.transport, ownerTurn, now });
          results.push({ type: "tool_result", tool_use_id: call.id, content: truncate(JSON.stringify(out), 20000) });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[outil] ${call.name} : ${msg}`);
          results.push({ type: "tool_result", tool_use_id: call.id, content: msg, is_error: true });
        }
      }
      messages.push({ role: "user", content: results });
    }
    return "J'ai fait beaucoup d'opérations d'un coup et je me suis arrêté par sécurité. Dis-moi où tu veux que je reprenne.";
  }
}
