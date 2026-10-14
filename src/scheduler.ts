// Horloge de l'agent : envois de campagne étalés, rappels, rituels (brief, check-in, revue hebdo).

import type { Agent } from "./agent.ts";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { localDay, localMinutes, parseLocal, partsIn } from "./time.ts";
import type { OutreachStatus, Transport } from "./transport/types.ts";

/** Un rituel manqué (agent éteint) n'est rattrapé que dans cette fenêtre. */
const RITUAL_GRACE_MIN = 90;
const OUTREACH_CHECK_MS = 30 * 60_000;
const MAX_CONSECUTIVE_FAILURES = 3;

export class Scheduler {
  private nextSendAt = 0;
  private busy = false;
  private failures = 0;
  private outreach: { at: number; status: OutreachStatus } | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: Store,
    private readonly cfg: Config,
    private readonly transport: Transport,
    private readonly agent: Agent,
    private readonly random: () => number = Math.random,
  ) {}

  start(intervalMs = 30_000): void {
    this.timer = setInterval(() => void this.tick(), intervalMs);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now = new Date()): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      if (!this.transport.isReady()) return;
      await this.onboarding();
      await this.reminders(now);
      await this.rituals(now);
      await this.sendNext(now);
    } catch (e) {
      console.error("Erreur du planificateur :", e);
    } finally {
      this.busy = false;
    }
  }

  private async onboarding(): Promise<void> {
    if (this.store.kvGet("welcomed")) return;
    this.store.kvSet("welcomed", new Date().toISOString());
    void this.agent.handle({
      type: "alerte",
      text: "Premier démarrage de l'agent. Présente-toi en quelques lignes (qui tu es, ce que tu peux faire pour lui, comment te parler, la commande /pause pour stopper les envois), puis commence à faire connaissance avec son business par UNE question.",
    });
  }

  private async reminders(now: Date): Promise<void> {
    for (const r of this.store.dueReminders(now.toISOString())) {
      this.store.completeReminder(r.id);
      void this.agent.handle({ type: "rappel", text: r.message, prospectId: r.prospect_id });
    }
  }

  private async rituals(now: Date): Promise<void> {
    const day = localDay(now, this.cfg.timezone);
    const minutes = localMinutes(now, this.cfg.timezone);
    const weekday = partsIn(now, this.cfg.timezone).weekday;
    const due = (key: string, at: { h: number; m: number }) => {
      const start = at.h * 60 + at.m;
      if (minutes < start || minutes > start + RITUAL_GRACE_MIN) return false;
      if (this.store.kvGet(key) === day) return false;
      this.store.kvSet(key, day);
      return true;
    };
    const workday = this.cfg.sendDays.includes(weekday);
    const reviewDay = weekday === this.cfg.weeklyReviewDay;

    if (workday && due("ritual_morning", this.cfg.morningBrief)) {
      void this.agent.handle({ type: "brief_du_matin" });
    }
    if (reviewDay && due("ritual_weekly", this.cfg.weeklyReview)) {
      void this.agent.handle({ type: "revue_hebdo" });
    } else if (workday && !reviewDay && due("ritual_evening", this.cfg.eveningCheckin)) {
      void this.agent.handle({ type: "checkin_du_soir" });
    }
  }

  private inSendWindow(now: Date): boolean {
    const { weekday } = partsIn(now, this.cfg.timezone);
    if (!this.cfg.sendDays.includes(weekday)) return false;
    const m = localMinutes(now, this.cfg.timezone);
    return m >= this.cfg.sendStart.h * 60 + this.cfg.sendStart.m && m < this.cfg.sendEnd.h * 60 + this.cfg.sendEnd.m;
  }

  private async outreachStatus(now: Date): Promise<OutreachStatus> {
    if (!this.outreach || now.getTime() - this.outreach.at > OUTREACH_CHECK_MS) {
      this.outreach = { at: now.getTime(), status: await this.transport.outreachStatus() };
    }
    return this.outreach.status;
  }

  private pauseRunning(): string[] {
    const running = this.store.listCampaigns(100).filter((c) => c.status === "running");
    for (const c of running) this.store.setCampaignStatus(c.id, "paused");
    return running.map((c) => `#${c.id} ${c.name}`);
  }

  async sendNext(now: Date): Promise<void> {
    const runningBefore = this.store.listCampaigns(100).filter((c) => c.status === "running");
    this.store.closeFinishedCampaigns();
    for (const c of runningBefore) {
      if (this.store.getCampaign(c.id)?.status === "done") {
        const st = this.store.campaignStats(c.id);
        void this.agent.handle({
          type: "alerte",
          text: `Campagne #${c.id} « ${c.name} » terminée : ${st.sent ?? 0} envoyés, ${st.failed ?? 0} échecs, ${st.replied} réponses à ce stade.`,
        });
      }
    }

    if (now.getTime() < this.nextSendAt || !this.inSendWindow(now)) return;
    const target = this.store.nextQueuedTarget();
    if (!target) return;

    const midnight = parseLocal(`${localDay(now, this.cfg.timezone)}T00:00`, this.cfg.timezone) ?? now;
    if (this.store.countSentSince(midnight.toISOString()) >= this.cfg.dailySendLimit) return;

    const status = await this.outreachStatus(now);
    if (status.blocked) {
      const paused = this.pauseRunning();
      void this.agent.handle({
        type: "alerte",
        text: `Envois stoppés pour protéger le numéro : ${status.reason ?? "restriction WhatsApp"}. Campagnes mises en pause : ${paused.join(", ") || "aucune"}.`,
      });
      return;
    }

    if (target.prospect_status === "do_not_contact" || !target.phone) {
      this.store.setTargetStatus(target.id, "skipped", target.phone ? "ne plus contacter" : "pas de numéro");
      return;
    }

    // Pause aléatoire avant la prochaine tentative, même en cas d'échec (rythme humain).
    const gap = this.cfg.minGapSeconds + this.random() * Math.max(0, this.cfg.maxGapSeconds - this.cfg.minGapSeconds);
    this.nextSendAt = now.getTime() + gap * 1000;

    try {
      if (!(await this.transport.checkPhone(target.phone))) {
        this.store.setTargetStatus(target.id, "failed", "pas de compte WhatsApp");
        return;
      }
      const { id } = await this.transport.sendToPhone(target.phone, target.body);
      this.store.transaction(() => {
        this.store.setTargetStatus(target.id, "sent");
        this.store.logMessage({ prospectId: target.prospect_id, direction: "out", body: target.body, waId: id, campaignId: target.campaign_id });
        if (target.prospect_status === "new" || target.prospect_status === "queued") {
          this.store.updateProspect(target.prospect_id, { status: "contacted" });
        }
      });
      this.failures = 0;
      if (status.newChatQuotaLeft !== null && this.outreach) {
        const left = Math.max(0, status.newChatQuotaLeft - 1);
        this.outreach.status = {
          blocked: left === 0,
          reason: left === 0 ? "Quota WhatsApp de nouvelles discussions épuisé pour la période" : null,
          newChatQuotaLeft: left,
        };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.store.setTargetStatus(target.id, "failed", msg.slice(0, 200));
      if (++this.failures >= MAX_CONSECUTIVE_FAILURES) {
        this.failures = 0;
        const paused = this.pauseRunning();
        void this.agent.handle({
          type: "alerte",
          text: `${MAX_CONSECUTIVE_FAILURES} échecs d'envoi d'affilée (dernier : ${msg}). Campagnes mises en pause par sécurité : ${paused.join(", ")}.`,
        });
      }
    }
  }
}
