// Outils mis à disposition de Claude : CRM, campagnes WhatsApp, finances, rappels, mémoire.

import type Anthropic from "@anthropic-ai/sdk";
import type { Config } from "./config.ts";
import { DEAL_STAGES, PROSPECT_STATUSES, type DealStage, type ProspectStatus, type Store } from "./db.ts";
import { normalizePhone, renderTemplate, truncate } from "./text.ts";
import { daysBetween, formatLocal, localDay, parseLocal } from "./time.ts";
import type { Transport } from "./transport/types.ts";

export interface ToolContext {
  store: Store;
  cfg: Config;
  transport: Transport;
  /** Vrai seulement quand le tour a été déclenché par un message du propriétaire. */
  ownerTurn: boolean;
  now: Date;
}

type Input = Record<string, unknown>;

const STATUS_DOC = `Statuts : new (à contacter), queued (en file d'envoi), contacted (1er message envoyé), replied (a répondu), interested, meeting (RDV fixé), proposal (devis envoyé), won (client), lost, do_not_contact.`;

export const TOOLS: Anthropic.Beta.BetaToolUnion[] = [
  {
    name: "add_prospects",
    description:
      "Ajoute des entreprises au CRM (doublons ignorés grâce au numéro). Les numéros locaux reçoivent l'indicatif par défaut. Utilise-le après une recherche web, une liste envoyée par le propriétaire, une carte de visite, etc.",
    input_schema: {
      type: "object",
      properties: {
        prospects: {
          type: "array",
          items: {
            type: "object",
            properties: {
              company: { type: "string", description: "Nom de l'entreprise" },
              phone: { type: "string", description: "Numéro WhatsApp, idéalement au format international" },
              contact_name: { type: "string", description: "Nom du décideur si connu" },
              sector: { type: "string" },
              city: { type: "string" },
              source: { type: "string", description: "D'où vient le contact (site, annuaire, recommandation...)" },
              notes: { type: "string" },
            },
            required: ["company"],
          },
        },
      },
      required: ["prospects"],
    },
  },
  {
    name: "search_prospects",
    description: `Cherche des prospects dans le CRM. ${STATUS_DOC}`,
    input_schema: {
      type: "object",
      properties: {
        status: { type: "array", items: { type: "string", enum: [...PROSPECT_STATUSES] } },
        sector: { type: "string" },
        city: { type: "string" },
        query: { type: "string", description: "Texte libre : nom, contact, notes, numéro" },
        limit: { type: "integer", description: "50 par défaut" },
      },
    },
  },
  {
    name: "update_prospect",
    description: `Met à jour un prospect : statut, coordonnées, prochaine action, ou ajoute une note datée. ${STATUS_DOC}`,
    input_schema: {
      type: "object",
      properties: {
        prospect_id: { type: "integer" },
        status: { type: "string", enum: [...PROSPECT_STATUSES] },
        company: { type: "string" },
        contact_name: { type: "string" },
        phone: { type: "string" },
        sector: { type: "string" },
        city: { type: "string" },
        note: { type: "string", description: "Note ajoutée à l'historique du prospect" },
        next_action: { type: "string" },
        next_action_at: { type: "string", description: "Heure locale AAAA-MM-JJTHH:MM" },
      },
      required: ["prospect_id"],
    },
  },
  {
    name: "get_prospect_thread",
    description: "Affiche la fiche d'un prospect et l'historique des messages WhatsApp échangés avec lui.",
    input_schema: {
      type: "object",
      properties: { prospect_id: { type: "integer" }, limit: { type: "integer" } },
      required: ["prospect_id"],
    },
  },
  {
    name: "create_campaign",
    description:
      "Prépare (sans rien envoyer) une campagne WhatsApp : sélectionne les prospects et génère un message personnalisé pour chacun. Variables : {{entreprise}}, {{contact}}, {{prenom}}, {{secteur}}, {{ville}}. Variantes aléatoires : {option A|option B}. Renvoie des exemples à montrer au propriétaire avant tout lancement. Pour une relance, filtre status=['contacted'] avec no_reply_for_days.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        offer: { type: "string", description: "Offre mise en avant" },
        message_template: { type: "string" },
        status: {
          type: "array",
          items: { type: "string", enum: [...PROSPECT_STATUSES] },
          description: "Statuts ciblés, ['new'] par défaut",
        },
        sector: { type: "string" },
        city: { type: "string" },
        prospect_ids: { type: "array", items: { type: "integer" } },
        no_reply_for_days: {
          type: "integer",
          description: "Ne garder que les prospects sans réponse depuis N jours après notre dernier message",
        },
        max_targets: { type: "integer", description: "100 par défaut" },
      },
      required: ["name", "message_template"],
    },
  },
  {
    name: "launch_campaign",
    description:
      "Met en file d'envoi une campagne préparée. N'appelle cet outil QUE si le propriétaire vient d'approuver explicitement cette campagne dans son dernier message. Les envois sont étalés (limite quotidienne, pauses aléatoires, heures de bureau).",
    input_schema: {
      type: "object",
      properties: { campaign_id: { type: "integer" } },
      required: ["campaign_id"],
    },
  },
  {
    name: "manage_campaign",
    description: "Liste les campagnes, donne les statistiques d'une campagne, ou la met en pause / la reprend / l'annule.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "status", "pause", "resume", "cancel"] },
        campaign_id: { type: "integer" },
      },
      required: ["action"],
    },
  },
  {
    name: "send_whatsapp_message",
    description:
      "Envoie immédiatement un message WhatsApp à un prospect du CRM (réponse, relance individuelle, confirmation de RDV). N'appelle cet outil QUE si le propriétaire vient d'approuver ce message précis dans son dernier message.",
    input_schema: {
      type: "object",
      properties: { prospect_id: { type: "integer" }, text: { type: "string" } },
      required: ["prospect_id", "text"],
    },
  },
  {
    name: "record_deal",
    description:
      "Crée ou met à jour une opportunité commerciale : proposition envoyée, contrat gagné (won), perdu (lost) ou client résilié (churned). Les montants sont en monnaie locale : frais de mise en place et abonnement mensuel.",
    input_schema: {
      type: "object",
      properties: {
        deal_id: { type: "integer", description: "Pour mettre à jour un deal existant" },
        client_name: { type: "string" },
        prospect_id: { type: "integer" },
        offer: { type: "string" },
        setup_amount: { type: "integer" },
        monthly_amount: { type: "integer" },
        stage: { type: "string", enum: [...DEAL_STAGES] },
        notes: { type: "string" },
      },
      required: ["client_name"],
    },
  },
  {
    name: "record_payment",
    description:
      "Enregistre un encaissement réel (argent reçu). C'est ce qui compte pour l'objectif. kind=recurring pour un abonnement/mensualité, one_shot pour un projet ponctuel ou des frais de mise en place.",
    input_schema: {
      type: "object",
      properties: {
        client_name: { type: "string" },
        amount: { type: "integer" },
        kind: { type: "string", enum: ["recurring", "one_shot"] },
        paid_on: { type: "string", description: "AAAA-MM-JJ, aujourd'hui par défaut" },
        deal_id: { type: "integer" },
        note: { type: "string" },
      },
      required: ["client_name", "amount", "kind"],
    },
  },
  {
    name: "log_activity",
    description:
      "Enregistre l'activité commerciale faite hors de l'agent (appels, visites, RDV, propositions, prospects contactés manuellement) pour le suivi de redevabilité.",
    input_schema: {
      type: "object",
      properties: {
        day: { type: "string", description: "AAAA-MM-JJ, aujourd'hui par défaut" },
        contacted: { type: "integer" },
        calls: { type: "integer" },
        visits: { type: "integer" },
        meetings: { type: "integer" },
        proposals: { type: "integer" },
        notes: { type: "string" },
      },
    },
  },
  {
    name: "schedule_reminder",
    description:
      "Programme un rappel : tu recevras un événement « rappel » à l'heure dite (heure locale). Utilise-le pour les RDV (rappel avant + suivi après), les relances promises, les échéances de paiement.",
    input_schema: {
      type: "object",
      properties: {
        due_at: { type: "string", description: "Heure locale AAAA-MM-JJTHH:MM" },
        message: { type: "string", description: "Ce que tu devras faire ou demander à ce moment-là" },
        prospect_id: { type: "integer" },
      },
      required: ["due_at", "message"],
    },
  },
  {
    name: "update_memory",
    description:
      "Mémoire long terme sur le business du propriétaire (offres, prix, clients, cible, préférences, décisions). action=add avec category et fact, ou action=remove avec memory_id pour retirer un fait obsolète.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["add", "remove"] },
        category: { type: "string", description: "offre, prix, client, cible, preference, decision, contexte..." },
        fact: { type: "string" },
        memory_id: { type: "integer" },
      },
      required: ["action"],
    },
  },
  {
    name: "set_goal",
    description: "Définit l'objectif de chiffre d'affaires encaissé (remplace l'objectif actif).",
    input_schema: {
      type: "object",
      properties: {
        label: { type: "string" },
        amount: { type: "integer" },
        start_day: { type: "string", description: "AAAA-MM-JJ" },
        deadline: { type: "string", description: "AAAA-MM-JJ" },
      },
      required: ["label", "amount", "start_day", "deadline"],
    },
  },
  {
    name: "business_report",
    description:
      "Rapport chiffré détaillé sur une période : entonnoir (envoyés, réponses, RDV, propositions, signatures), taux de conversion, encaissements, campagnes, deals ouverts. Utilise-le pour les revues et avant de donner un conseil stratégique.",
    input_schema: {
      type: "object",
      properties: { period_days: { type: "integer", description: "7 par défaut" } },
    },
  },
];

// ---------------------------------------------------------------------------

const s = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const n = (v: unknown): number | undefined => {
  const x = typeof v === "string" ? Number(v) : v;
  return typeof x === "number" && Number.isFinite(x) ? Math.round(x) : undefined;
};
const req = <T>(v: T | undefined, name: string): T => {
  if (v === undefined) throw new Error(`Paramètre « ${name} » manquant ou invalide`);
  return v;
};
const isDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

function firstName(full: string | null): string | null {
  if (!full) return null;
  const parts = full.replace(/^(m\.|mr|mme|mlle|dr|me)\s+/i, "").split(/\s+/);
  return parts[0] ?? null;
}

export async function runTool(name: string, input: Input, ctx: ToolContext): Promise<unknown> {
  const { store, cfg, transport } = ctx;
  const today = localDay(ctx.now, cfg.timezone);

  switch (name) {
    case "add_prospects": {
      const list = Array.isArray(input.prospects) ? (input.prospects as Input[]) : [];
      const created: { id: number; company: string }[] = [];
      const duplicates: { id: number; company: string }[] = [];
      const invalid: string[] = [];
      for (const p of list) {
        const company = s(p.company);
        if (!company) continue;
        const rawPhone = s(p.phone);
        const phone = rawPhone ? normalizePhone(rawPhone, cfg.defaultCountryCode) : null;
        if (rawPhone && !phone) invalid.push(`${company} (${rawPhone})`);
        const r = store.addProspect({
          company,
          phone,
          contact_name: s(p.contact_name) ?? null,
          sector: s(p.sector) ?? null,
          city: s(p.city) ?? null,
          source: s(p.source) ?? null,
          notes: s(p.notes) ?? "",
        });
        (r.created ? created : duplicates).push({ id: r.id, company });
      }
      return {
        ajoutes: created.length,
        doublons: duplicates.length,
        numeros_invalides: invalid,
        sans_numero: list.filter((p) => !s(p.phone)).length,
        ids: created.map((c) => c.id),
      };
    }

    case "search_prospects": {
      const rows = store.searchProspects({
        status: Array.isArray(input.status) ? (input.status as string[]) : undefined,
        sector: s(input.sector),
        city: s(input.city),
        query: s(input.query),
        limit: Math.min(n(input.limit) ?? 50, 200),
      });
      return {
        total: rows.length,
        prospects: rows.map((p) => ({
          id: p.id,
          entreprise: p.company,
          contact: p.contact_name,
          tel: p.phone,
          secteur: p.sector,
          ville: p.city,
          statut: p.status,
          prochaine_action: p.next_action,
          notes: truncate(p.notes, 200),
        })),
      };
    }

    case "update_prospect": {
      const id = req(n(input.prospect_id), "prospect_id");
      const p = store.getProspect(id);
      if (!p) throw new Error(`Prospect ${id} introuvable`);
      const status = s(input.status) as ProspectStatus | undefined;
      if (status && !PROSPECT_STATUSES.includes(status)) throw new Error(`Statut inconnu : ${status}`);
      const rawPhone = s(input.phone);
      const phone = rawPhone ? normalizePhone(rawPhone, cfg.defaultCountryCode) : undefined;
      if (rawPhone && !phone) throw new Error(`Numéro invalide : ${rawPhone}`);
      const nextAt = s(input.next_action_at);
      store.updateProspect(id, {
        status,
        company: s(input.company),
        contact_name: s(input.contact_name),
        phone: phone ?? undefined, // undefined = numéro inchangé
        sector: s(input.sector),
        city: s(input.city),
        next_action: s(input.next_action),
        next_action_at: nextAt ? (parseLocal(nextAt, cfg.timezone)?.toISOString() ?? undefined) : undefined,
      });
      const note = s(input.note);
      if (note) store.appendProspectNote(id, note);
      if (status === "do_not_contact") store.cancelQueuedForProspect(id, "ne plus contacter");
      return { ok: true, prospect: store.getProspect(id) };
    }

    case "get_prospect_thread": {
      const id = req(n(input.prospect_id), "prospect_id");
      const p = store.getProspect(id);
      if (!p) throw new Error(`Prospect ${id} introuvable`);
      return {
        prospect: p,
        messages: store.thread(id, Math.min(n(input.limit) ?? 30, 100)).map((m) => ({
          sens: m.direction === "in" ? "prospect" : "nous",
          quand: formatLocal(new Date(m.created_at), cfg.timezone),
          texte: m.body,
        })),
      };
    }

    case "create_campaign": {
      const name = req(s(input.name), "name");
      const template = req(s(input.message_template), "message_template");
      const statuses = Array.isArray(input.status) && input.status.length ? (input.status as string[]) : ["new"];
      const max = Math.min(n(input.max_targets) ?? 100, 500);
      const noReplyDays = n(input.no_reply_for_days);
      const ids = Array.isArray(input.prospect_ids) ? (input.prospect_ids as unknown[]).map(n).filter((x): x is number => x !== undefined) : undefined;

      let candidates = store.searchProspects({
        status: statuses.filter((st) => st !== "do_not_contact"),
        sector: s(input.sector),
        city: s(input.city),
        ids,
        limit: 2000,
      });
      if (noReplyDays !== undefined) {
        const stale = new Set(store.staleContacted(noReplyDays, 2000).map((p) => p.id));
        candidates = candidates.filter((p) => stale.has(p.id));
      }
      const busy = new Set(
        store
          .listCampaigns(50)
          .filter((c) => c.status === "draft" || c.status === "running" || c.status === "paused")
          .flatMap((c) => [...store.targets(c.id, "pending"), ...store.targets(c.id, "queued")].map((t) => t.prospect_id)),
      );
      const noPhone = candidates.filter((p) => !p.phone).length;
      const inOtherCampaign = candidates.filter((p) => p.phone && busy.has(p.id)).length;
      candidates = candidates.filter((p) => p.phone && !busy.has(p.id)).slice(0, max);
      if (!candidates.length) {
        return {
          erreur: "Aucun prospect éligible avec ces critères",
          sans_numero: noPhone,
          deja_dans_une_campagne: inOtherCampaign,
        };
      }

      const samples: { prospect: string; message: string }[] = [];
      const missingCount: Record<string, number> = {};
      const id = store.transaction(() => {
        const campaignId = store.createCampaign({ name, offer: s(input.offer) ?? "", template });
        for (const p of candidates) {
          const { text, missing } = renderTemplate(template, {
            entreprise: p.company,
            contact: p.contact_name,
            prenom: firstName(p.contact_name),
            secteur: p.sector,
            ville: p.city,
          });
          for (const m of missing) missingCount[m] = (missingCount[m] ?? 0) + 1;
          store.addTarget(campaignId, p.id, text);
          if (samples.length < 3) samples.push({ prospect: `#${p.id} ${p.company}`, message: text });
        }
        return campaignId;
      });
      const perDay = Math.max(1, cfg.dailySendLimit);
      return {
        campaign_id: id,
        statut: "draft (rien n'est envoyé)",
        destinataires: candidates.length,
        exclus_sans_numero: noPhone,
        exclus_deja_dans_une_campagne: inOtherCampaign,
        variables_manquantes: missingCount,
        exemples: samples,
        rythme: `${perDay} messages/jour max, ${cfg.sendStart.h}h${String(cfg.sendStart.m).padStart(2, "0")}-${cfg.sendEnd.h}h${String(cfg.sendEnd.m).padStart(2, "0")}, pauses aléatoires de ${Math.round(cfg.minGapSeconds / 60)} à ${Math.round(cfg.maxGapSeconds / 60)} min`,
        duree_estimee_jours_ouvres: Math.ceil(candidates.length / perDay),
        a_faire: "Montre les exemples au propriétaire et attends son feu vert explicite avant launch_campaign.",
      };
    }

    case "launch_campaign": {
      if (!ctx.ownerTurn) {
        throw new Error("Refusé : le lancement exige l'approbation explicite du propriétaire dans son dernier message.");
      }
      const id = req(n(input.campaign_id), "campaign_id");
      const c = store.getCampaign(id);
      if (!c) throw new Error(`Campagne ${id} introuvable`);
      if (c.status !== "draft" && c.status !== "paused") throw new Error(`Campagne ${id} déjà ${c.status}`);
      const status = await transport.outreachStatus();
      let queued = 0;
      store.transaction(() => {
        for (const t of store.targets(id, "pending")) {
          const p = store.getProspect(t.prospect_id);
          if (!p || p.status === "do_not_contact") {
            store.setTargetStatus(t.id, "skipped", "ne plus contacter");
            continue;
          }
          store.setTargetStatus(t.id, "queued");
          if (p.status === "new") store.updateProspect(p.id, { status: "queued" });
          queued++;
        }
        store.setCampaignStatus(id, "running");
      });
      const total = store.targets(id, "queued").length;
      return {
        ok: true,
        campaign_id: id,
        nouvellement_en_file: queued,
        total_en_file: total,
        duree_estimee_jours_ouvres: Math.ceil(total / Math.max(1, cfg.dailySendLimit)),
        avertissement_whatsapp: status.blocked ? status.reason : null,
        quota_nouvelles_discussions: status.newChatQuotaLeft,
      };
    }

    case "manage_campaign": {
      const action = req(s(input.action), "action");
      if (action === "list") {
        return store.listCampaigns(15).map((c) => ({ id: c.id, nom: c.name, statut: c.status, stats: store.campaignStats(c.id) }));
      }
      const id = req(n(input.campaign_id), "campaign_id");
      const c = store.getCampaign(id);
      if (!c) throw new Error(`Campagne ${id} introuvable`);
      if (action === "pause" && c.status === "running") store.setCampaignStatus(id, "paused");
      if (action === "resume" && c.status === "paused") {
        if (!ctx.ownerTurn) throw new Error("Refusé : reprise sans approbation du propriétaire.");
        store.setCampaignStatus(id, "running");
      }
      if (action === "cancel") {
        store.transaction(() => {
          store.setCampaignStatus(id, "cancelled");
          for (const t of [...store.targets(id, "pending"), ...store.targets(id, "queued")]) {
            store.setTargetStatus(t.id, "skipped", "campagne annulée");
            const p = store.getProspect(t.prospect_id);
            if (p?.status === "queued") store.updateProspect(p.id, { status: "new" });
          }
        });
      }
      const after = store.getCampaign(id);
      return { id, nom: after?.name, statut: after?.status, offre: after?.offer, gabarit: after?.template, stats: store.campaignStats(id) };
    }

    case "send_whatsapp_message": {
      if (!ctx.ownerTurn) {
        throw new Error("Refusé : un envoi exige l'approbation explicite du propriétaire dans son dernier message.");
      }
      const id = req(n(input.prospect_id), "prospect_id");
      const text = req(s(input.text), "text");
      const p = store.getProspect(id);
      if (!p) throw new Error(`Prospect ${id} introuvable`);
      if (!p.phone) throw new Error(`Le prospect ${id} n'a pas de numéro`);
      if (p.status === "do_not_contact") throw new Error("Ce prospect a demandé à ne plus être contacté.");
      const { id: waId } = await transport.sendToPhone(p.phone, text);
      store.logMessage({ prospectId: id, direction: "out", body: text, waId });
      if (p.status === "new" || p.status === "queued") store.updateProspect(id, { status: "contacted" });
      return { ok: true, envoye_a: `${p.company} (+${p.phone})` };
    }

    case "record_deal": {
      const stage = s(input.stage) as DealStage | undefined;
      if (stage && !DEAL_STAGES.includes(stage)) throw new Error(`Étape inconnue : ${stage}`);
      const prospectId = n(input.prospect_id);
      const id = store.upsertDeal({
        id: n(input.deal_id),
        client_name: req(s(input.client_name), "client_name"),
        prospect_id: prospectId ?? null,
        offer: s(input.offer),
        setup_amount: n(input.setup_amount),
        monthly_amount: n(input.monthly_amount),
        stage,
        notes: s(input.notes),
      });
      if (prospectId && stage) {
        const map: Partial<Record<DealStage, ProspectStatus>> = { proposal: "proposal", won: "won", lost: "lost" };
        const st = map[stage];
        if (st) store.updateProspect(prospectId, { status: st });
      }
      return { ok: true, deal_id: id, mrr_total: store.mrr() };
    }

    case "record_payment": {
      const paidOn = s(input.paid_on) ?? today;
      if (!isDay(paidOn)) throw new Error("paid_on doit être au format AAAA-MM-JJ");
      const amount = req(n(input.amount), "amount");
      if (amount <= 0) throw new Error("Le montant doit être positif");
      const kind = s(input.kind) === "recurring" ? "recurring" : "one_shot";
      const id = store.addPayment({
        client_name: req(s(input.client_name), "client_name"),
        amount,
        kind,
        paid_on: paidOn,
        deal_id: n(input.deal_id) ?? null,
        note: s(input.note),
      });
      const goal = store.activeGoal();
      const progress = goal ? store.revenueBetween(goal.start_day, goal.deadline).total : null;
      return {
        ok: true,
        payment_id: id,
        encaisse_objectif: progress,
        objectif: goal?.amount ?? null,
        pourcentage: goal && progress !== null ? Math.round((progress / goal.amount) * 1000) / 10 : null,
      };
    }

    case "log_activity": {
      const day = s(input.day) ?? today;
      if (!isDay(day)) throw new Error("day doit être au format AAAA-MM-JJ");
      store.logActivity({
        day,
        contacted: n(input.contacted),
        calls: n(input.calls),
        visits: n(input.visits),
        meetings: n(input.meetings),
        proposals: n(input.proposals),
        notes: s(input.notes),
      });
      return { ok: true, semaine: store.activitySince(localDay(new Date(ctx.now.getTime() - 6 * 86_400_000), cfg.timezone)) };
    }

    case "schedule_reminder": {
      const dueRaw = req(s(input.due_at), "due_at");
      const due = parseLocal(dueRaw, cfg.timezone);
      if (!due) throw new Error(`Date invalide : ${dueRaw} (attendu AAAA-MM-JJTHH:MM)`);
      if (due.getTime() < ctx.now.getTime() - 60_000) throw new Error("Cette date est déjà passée");
      const id = store.addReminder(due.toISOString(), req(s(input.message), "message"), n(input.prospect_id) ?? null);
      return { ok: true, reminder_id: id, prevu_le: formatLocal(due, cfg.timezone) };
    }

    case "update_memory": {
      const action = req(s(input.action), "action");
      if (action === "remove") {
        const id = req(n(input.memory_id), "memory_id");
        return { ok: store.forget(id) };
      }
      const id = store.remember(s(input.category) ?? "contexte", req(s(input.fact), "fact"));
      return { ok: true, memory_id: id };
    }

    case "set_goal": {
      const start = req(s(input.start_day), "start_day");
      const deadline = req(s(input.deadline), "deadline");
      if (!isDay(start) || !isDay(deadline)) throw new Error("Dates au format AAAA-MM-JJ");
      const amount = req(n(input.amount), "amount");
      const id = store.setGoal({ label: req(s(input.label), "label"), amount, start_day: start, deadline });
      return { ok: true, goal_id: id, jours_restants: daysBetween(today, deadline) };
    }

    case "business_report": {
      const days = Math.max(1, Math.min(n(input.period_days) ?? 7, 365));
      return businessReport(store, cfg, ctx.now, days);
    }

    default:
      throw new Error(`Outil inconnu : ${name}`);
  }
}

export function businessReport(store: Store, cfg: Config, now: Date, days: number) {
  const since = new Date(now.getTime() - days * 86_400_000);
  const sinceIso = since.toISOString();
  const sinceDay = localDay(since, cfg.timezone);
  const today = localDay(now, cfg.timezone);
  const q = (sql: string, ...p: (string | number)[]) =>
    (store.db.prepare(sql).get(...p) as { n: number | null } | undefined)?.n ?? 0;

  const sent = q("SELECT COUNT(*) AS n FROM messages WHERE direction = 'out' AND created_at >= ?", sinceIso);
  const prospectsContacted = q(
    "SELECT COUNT(DISTINCT prospect_id) AS n FROM messages WHERE direction = 'out' AND created_at >= ?",
    sinceIso,
  );
  const prospectsReplied = q(
    "SELECT COUNT(DISTINCT prospect_id) AS n FROM messages WHERE direction = 'in' AND created_at >= ?",
    sinceIso,
  );
  const proposals = q("SELECT COUNT(*) AS n FROM deals WHERE created_at >= ?", sinceIso);
  const won = q("SELECT COUNT(*) AS n FROM deals WHERE stage = 'won' AND closed_at >= ?", sinceIso);
  const lost = q("SELECT COUNT(*) AS n FROM deals WHERE stage = 'lost' AND closed_at >= ?", sinceIso);
  const revenue = store.revenueBetween(sinceDay, today);
  const activity = store.activitySince(sinceDay);
  const rate = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : "n/a");
  const goal = store.activeGoal();

  return {
    periode: `${days} derniers jours (depuis le ${sinceDay})`,
    entonnoir: {
      messages_whatsapp_envoyes: sent,
      prospects_contactes_whatsapp: prospectsContacted,
      prospects_ayant_repondu: prospectsReplied,
      taux_de_reponse: rate(prospectsReplied, prospectsContacted),
      activite_terrain_declaree: activity,
      propositions_creees: proposals,
      deals_gagnes: won,
      deals_perdus: lost,
      taux_de_closing: rate(won, won + lost),
    },
    encaissements_periode: revenue,
    objectif: goal
      ? { ...goal, encaisse: store.revenueBetween(goal.start_day, goal.deadline).total, jours_restants: daysBetween(today, goal.deadline) }
      : null,
    mrr: store.mrr(),
    pipeline: store.pipelineCounts(),
    deals_ouverts: store.listDeals(["proposal"]).map((d) => ({
      id: d.id,
      client: d.client_name,
      offre: d.offer,
      mise_en_place: d.setup_amount,
      mensuel: d.monthly_amount,
      depuis: d.created_at.slice(0, 10),
    })),
    derniers_encaissements: store.recentPayments(8),
    campagnes: store.listCampaigns(5).map((c) => ({ id: c.id, nom: c.name, statut: c.status, stats: store.campaignStats(c.id) })),
  };
}

/** Outils serveur (exécutés par Anthropic) ajoutés à la liste. */
export function serverTools(cfg: Config): Anthropic.Beta.BetaToolUnion[] {
  if (!cfg.webSearch) return [];
  const user_location = {
    type: "approximate" as const,
    country: cfg.webSearchCountry,
    city: cfg.webSearchCity,
    timezone: cfg.timezone,
  };
  // Le filtrage dynamique (20260209) n'existe pas sur Haiku : version de base dans ce cas.
  if (cfg.model.includes("haiku")) {
    return [{ type: "web_search_20250305", name: "web_search", max_uses: 8, user_location }];
  }
  return [{ type: "web_search_20260209", name: "web_search", max_uses: 8, user_location }];
}
