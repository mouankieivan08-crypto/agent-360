// Mini-CRM local en SQLite (module natif node:sqlite, aucune dépendance à compiler).

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

export const PROSPECT_STATUSES = [
  "new",
  "queued",
  "contacted",
  "replied",
  "interested",
  "meeting",
  "proposal",
  "won",
  "lost",
  "do_not_contact",
] as const;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

export const DEAL_STAGES = ["proposal", "won", "lost", "churned"] as const;
export type DealStage = (typeof DEAL_STAGES)[number];

export interface Prospect {
  id: number;
  company: string;
  contact_name: string | null;
  phone: string | null;
  sector: string | null;
  city: string | null;
  source: string | null;
  status: ProspectStatus;
  notes: string;
  next_action: string | null;
  next_action_at: string | null;
  last_outbound_at: string | null;
  last_inbound_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Campaign {
  id: number;
  name: string;
  offer: string;
  template: string;
  status: "draft" | "running" | "paused" | "done" | "cancelled";
  created_at: string;
}

export interface CampaignTarget {
  id: number;
  campaign_id: number;
  prospect_id: number;
  body: string;
  status: "pending" | "queued" | "sent" | "failed" | "skipped";
  sent_at: string | null;
  error: string | null;
}

export interface Deal {
  id: number;
  prospect_id: number | null;
  client_name: string;
  offer: string;
  setup_amount: number;
  monthly_amount: number;
  stage: DealStage;
  notes: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface Reminder {
  id: number;
  due_at: string;
  message: string;
  prospect_id: number | null;
  done: number;
}

export interface Goal {
  id: number;
  label: string;
  amount: number;
  start_day: string;
  deadline: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS prospects (
  id INTEGER PRIMARY KEY,
  company TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT UNIQUE,
  sector TEXT,
  city TEXT,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  notes TEXT NOT NULL DEFAULT '',
  next_action TEXT,
  next_action_at TEXT,
  last_outbound_at TEXT,
  last_inbound_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  prospect_id INTEGER NOT NULL REFERENCES prospects(id),
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  body TEXT NOT NULL,
  wa_id TEXT,
  campaign_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_prospect ON messages(prospect_id, created_at);
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  offer TEXT NOT NULL DEFAULT '',
  template TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS campaign_targets (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id),
  prospect_id INTEGER NOT NULL REFERENCES prospects(id),
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  sent_at TEXT,
  error TEXT,
  UNIQUE (campaign_id, prospect_id)
);
CREATE TABLE IF NOT EXISTS deals (
  id INTEGER PRIMARY KEY,
  prospect_id INTEGER REFERENCES prospects(id),
  client_name TEXT NOT NULL,
  offer TEXT NOT NULL DEFAULT '',
  setup_amount INTEGER NOT NULL DEFAULT 0,
  monthly_amount INTEGER NOT NULL DEFAULT 0,
  stage TEXT NOT NULL DEFAULT 'proposal',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  client_name TEXT NOT NULL,
  amount INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('recurring', 'one_shot')),
  paid_on TEXT NOT NULL,
  deal_id INTEGER REFERENCES deals(id),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY,
  due_at TEXT NOT NULL,
  message TEXT NOT NULL,
  prospect_id INTEGER REFERENCES prospects(id),
  done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memory (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL,
  fact TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS owner_chat (
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('owner', 'agent', 'event')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY,
  day TEXT NOT NULL,
  contacted INTEGER NOT NULL DEFAULT 0,
  calls INTEGER NOT NULL DEFAULT 0,
  visits INTEGER NOT NULL DEFAULT 0,
  meetings INTEGER NOT NULL DEFAULT 0,
  proposals INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS goals (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  amount INTEGER NOT NULL,
  start_day TEXT NOT NULL,
  deadline TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY,
  amount INTEGER NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('reinvestissement', 'charges', 'salaire', 'perso')),
  spent_on TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export const EXPENSE_CATEGORIES = ["reinvestissement", "charges", "salaire", "perso"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

const now = () => new Date().toISOString();

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA);
  }

  private all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  private get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  private run(sql: string, ...params: SQLInputValue[]): { id: number; changes: number } {
    const r = this.db.prepare(sql).run(...params);
    return { id: Number(r.lastInsertRowid), changes: Number(r.changes) };
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  // ---------- Prospects ----------

  addProspect(p: {
    company: string;
    phone: string | null;
    contact_name?: string | null;
    sector?: string | null;
    city?: string | null;
    source?: string | null;
    notes?: string | null;
  }): { id: number; created: boolean } {
    if (p.phone) {
      const existing = this.findProspectByPhone(p.phone);
      if (existing) return { id: existing.id, created: false };
    }
    const t = now();
    const { id } = this.run(
      `INSERT INTO prospects (company, contact_name, phone, sector, city, source, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      p.company,
      p.contact_name ?? null,
      p.phone,
      p.sector ?? null,
      p.city ?? null,
      p.source ?? null,
      p.notes ?? "",
      t,
      t,
    );
    return { id, created: true };
  }

  getProspect(id: number): Prospect | undefined {
    return this.get<Prospect>("SELECT * FROM prospects WHERE id = ?", id);
  }

  findProspectByPhone(phone: string): Prospect | undefined {
    return this.get<Prospect>("SELECT * FROM prospects WHERE phone = ?", phone);
  }

  searchProspects(f: {
    status?: string[];
    sector?: string;
    city?: string;
    query?: string;
    ids?: number[];
    limit?: number;
  }): Prospect[] {
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    if (f.ids?.length) {
      where.push(`id IN (${f.ids.map(() => "?").join(",")})`);
      params.push(...f.ids);
    }
    if (f.status?.length) {
      where.push(`status IN (${f.status.map(() => "?").join(",")})`);
      params.push(...f.status);
    }
    if (f.sector) {
      where.push("sector LIKE ?");
      params.push(`%${f.sector}%`);
    }
    if (f.city) {
      where.push("city LIKE ?");
      params.push(`%${f.city}%`);
    }
    if (f.query) {
      where.push("(company LIKE ? OR contact_name LIKE ? OR notes LIKE ? OR phone LIKE ?)");
      const q = `%${f.query}%`;
      params.push(q, q, q, q);
    }
    const sql = `SELECT * FROM prospects ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
                 ORDER BY updated_at DESC, id DESC LIMIT ?`;
    params.push(f.limit ?? 50);
    return this.all<Prospect>(sql, ...params);
  }

  updateProspect(
    id: number,
    patch: Partial<
      Pick<
        Prospect,
        | "company"
        | "contact_name"
        | "phone"
        | "sector"
        | "city"
        | "status"
        | "next_action"
        | "next_action_at"
        | "last_outbound_at"
        | "last_inbound_at"
      >
    >,
  ): void {
    const keys = Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined);
    if (!keys.length) return;
    const sets = keys.map((k) => `${k} = ?`).join(", ");
    const values = keys.map((k) => (patch as Record<string, SQLInputValue>)[k] ?? null);
    this.run(`UPDATE prospects SET ${sets}, updated_at = ? WHERE id = ?`, ...values, now(), id);
  }

  appendProspectNote(id: number, note: string): void {
    const stamp = now().slice(0, 10);
    this.run(
      `UPDATE prospects SET notes = CASE WHEN notes = '' THEN ? ELSE notes || char(10) || ? END, updated_at = ? WHERE id = ?`,
      `[${stamp}] ${note}`,
      `[${stamp}] ${note}`,
      now(),
      id,
    );
  }

  pipelineCounts(): Record<string, number> {
    const rows = this.all<{ status: string; n: number }>(
      "SELECT status, COUNT(*) AS n FROM prospects GROUP BY status",
    );
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  }

  /** Prospects contactés sans réponse depuis au moins `days` jours. */
  staleContacted(days: number, limit = 100): Prospect[] {
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    return this.all<Prospect>(
      `SELECT * FROM prospects
       WHERE status = 'contacted' AND last_outbound_at IS NOT NULL AND last_outbound_at <= ?
         AND (last_inbound_at IS NULL OR last_inbound_at < last_outbound_at)
       ORDER BY last_outbound_at ASC LIMIT ?`,
      cutoff,
      limit,
    );
  }

  // ---------- Messages ----------

  logMessage(m: {
    prospectId: number;
    direction: "in" | "out";
    body: string;
    waId?: string | null;
    campaignId?: number | null;
  }): void {
    const t = now();
    this.run(
      `INSERT INTO messages (prospect_id, direction, body, wa_id, campaign_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      m.prospectId,
      m.direction,
      m.body,
      m.waId ?? null,
      m.campaignId ?? null,
      t,
    );
    this.updateProspect(m.prospectId, m.direction === "in" ? { last_inbound_at: t } : { last_outbound_at: t });
  }

  thread(prospectId: number, limit = 20): { direction: string; body: string; created_at: string }[] {
    return this.all<{ direction: string; body: string; created_at: string }>(
      `SELECT direction, body, created_at FROM (
         SELECT * FROM messages WHERE prospect_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
       ) ORDER BY created_at ASC, id ASC`,
      prospectId,
      limit,
    );
  }

  // ---------- Campagnes ----------

  createCampaign(c: { name: string; offer: string; template: string }): number {
    return this.run(
      `INSERT INTO campaigns (name, offer, template, created_at) VALUES (?, ?, ?, ?)`,
      c.name,
      c.offer,
      c.template,
      now(),
    ).id;
  }

  getCampaign(id: number): Campaign | undefined {
    return this.get<Campaign>("SELECT * FROM campaigns WHERE id = ?", id);
  }

  listCampaigns(limit = 10): Campaign[] {
    return this.all<Campaign>("SELECT * FROM campaigns ORDER BY id DESC LIMIT ?", limit);
  }

  setCampaignStatus(id: number, status: Campaign["status"]): void {
    this.run("UPDATE campaigns SET status = ? WHERE id = ?", status, id);
  }

  addTarget(campaignId: number, prospectId: number, body: string): boolean {
    const r = this.run(
      `INSERT OR IGNORE INTO campaign_targets (campaign_id, prospect_id, body) VALUES (?, ?, ?)`,
      campaignId,
      prospectId,
      body,
    );
    return r.changes > 0;
  }

  targets(campaignId: number, status?: CampaignTarget["status"]): CampaignTarget[] {
    return status
      ? this.all<CampaignTarget>(
          "SELECT * FROM campaign_targets WHERE campaign_id = ? AND status = ? ORDER BY id",
          campaignId,
          status,
        )
      : this.all<CampaignTarget>("SELECT * FROM campaign_targets WHERE campaign_id = ? ORDER BY id", campaignId);
  }

  setTargetStatus(id: number, status: CampaignTarget["status"], error: string | null = null): void {
    this.run(
      `UPDATE campaign_targets SET status = ?, error = ?, sent_at = CASE WHEN ? = 'sent' THEN ? ELSE sent_at END WHERE id = ?`,
      status,
      error,
      status,
      now(),
      id,
    );
  }

  /** Prochain message en file d'attente parmi les campagnes actives. */
  nextQueuedTarget(): (CampaignTarget & { phone: string | null; prospect_status: string }) | undefined {
    return this.get(
      `SELECT t.*, p.phone AS phone, p.status AS prospect_status
       FROM campaign_targets t
       JOIN campaigns c ON c.id = t.campaign_id
       JOIN prospects p ON p.id = t.prospect_id
       WHERE t.status = 'queued' AND c.status = 'running'
       ORDER BY t.id LIMIT 1`,
    );
  }

  campaignStats(campaignId: number): Record<string, number> & { replied: number } {
    const rows = this.all<{ status: string; n: number }>(
      "SELECT status, COUNT(*) AS n FROM campaign_targets WHERE campaign_id = ? GROUP BY status",
      campaignId,
    );
    const stats: Record<string, number> = Object.fromEntries(rows.map((r) => [r.status, r.n]));
    const replied = this.get<{ n: number }>(
      `SELECT COUNT(DISTINCT t.prospect_id) AS n FROM campaign_targets t
       JOIN messages m ON m.prospect_id = t.prospect_id AND m.direction = 'in' AND m.created_at >= t.sent_at
       WHERE t.campaign_id = ? AND t.status = 'sent'`,
      campaignId,
    );
    return { ...stats, replied: replied?.n ?? 0 };
  }

  /** Marque les campagnes en cours dont il ne reste plus rien à envoyer comme terminées. */
  closeFinishedCampaigns(): void {
    this.run(
      `UPDATE campaigns SET status = 'done' WHERE status = 'running' AND NOT EXISTS (
         SELECT 1 FROM campaign_targets t WHERE t.campaign_id = campaigns.id AND t.status = 'queued')`,
    );
  }

  cancelQueuedForProspect(prospectId: number, reason: string): void {
    this.run(
      `UPDATE campaign_targets SET status = 'skipped', error = ? WHERE prospect_id = ? AND status IN ('pending', 'queued')`,
      reason,
      prospectId,
    );
  }

  countSentSince(isoUtc: string): number {
    return (
      this.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM campaign_targets WHERE status = 'sent' AND sent_at >= ?`,
        isoUtc,
      )?.n ?? 0
    );
  }

  // ---------- Deals et encaissements ----------

  upsertDeal(d: {
    id?: number;
    prospect_id?: number | null;
    client_name: string;
    offer?: string;
    setup_amount?: number;
    monthly_amount?: number;
    stage?: DealStage;
    notes?: string;
  }): number {
    const t = now();
    if (d.id) {
      const existing = this.get<Deal>("SELECT * FROM deals WHERE id = ?", d.id);
      if (!existing) throw new Error(`Deal ${d.id} introuvable`);
      const stage = d.stage ?? existing.stage;
      const closed = stage !== existing.stage && stage !== "proposal" ? t : existing.closed_at;
      this.run(
        `UPDATE deals SET client_name = ?, offer = ?, setup_amount = ?, monthly_amount = ?, stage = ?,
           notes = ?, updated_at = ?, closed_at = ?, prospect_id = ? WHERE id = ?`,
        d.client_name || existing.client_name,
        d.offer ?? existing.offer,
        d.setup_amount ?? existing.setup_amount,
        d.monthly_amount ?? existing.monthly_amount,
        stage,
        d.notes ? (existing.notes ? `${existing.notes}\n${d.notes}` : d.notes) : existing.notes,
        t,
        closed,
        d.prospect_id ?? existing.prospect_id,
        d.id,
      );
      return d.id;
    }
    const stage = d.stage ?? "proposal";
    return this.run(
      `INSERT INTO deals (prospect_id, client_name, offer, setup_amount, monthly_amount, stage, notes, created_at, updated_at, closed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      d.prospect_id ?? null,
      d.client_name,
      d.offer ?? "",
      d.setup_amount ?? 0,
      d.monthly_amount ?? 0,
      stage,
      d.notes ?? "",
      t,
      t,
      stage === "proposal" ? null : t,
    ).id;
  }

  listDeals(stages?: DealStage[]): Deal[] {
    if (!stages?.length) return this.all<Deal>("SELECT * FROM deals ORDER BY updated_at DESC LIMIT 50");
    return this.all<Deal>(
      `SELECT * FROM deals WHERE stage IN (${stages.map(() => "?").join(",")}) ORDER BY updated_at DESC LIMIT 50`,
      ...stages,
    );
  }

  /** Revenu mensuel récurrent : somme des abonnements des clients gagnés et actifs. */
  mrr(): number {
    return this.get<{ s: number | null }>("SELECT SUM(monthly_amount) AS s FROM deals WHERE stage = 'won'")?.s ?? 0;
  }

  addPayment(p: {
    client_name: string;
    amount: number;
    kind: "recurring" | "one_shot";
    paid_on: string;
    deal_id?: number | null;
    note?: string;
  }): number {
    return this.run(
      `INSERT INTO payments (client_name, amount, kind, paid_on, deal_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      p.client_name,
      p.amount,
      p.kind,
      p.paid_on,
      p.deal_id ?? null,
      p.note ?? "",
      now(),
    ).id;
  }

  revenueBetween(fromDay: string, toDay: string): { total: number; recurring: number; one_shot: number } {
    const rows = this.all<{ kind: string; s: number }>(
      "SELECT kind, SUM(amount) AS s FROM payments WHERE paid_on >= ? AND paid_on <= ? GROUP BY kind",
      fromDay,
      toDay,
    );
    const recurring = rows.find((r) => r.kind === "recurring")?.s ?? 0;
    const one_shot = rows.find((r) => r.kind === "one_shot")?.s ?? 0;
    return { total: recurring + one_shot, recurring, one_shot };
  }

  recentPayments(limit = 10): { client_name: string; amount: number; kind: string; paid_on: string }[] {
    return this.all("SELECT client_name, amount, kind, paid_on FROM payments ORDER BY paid_on DESC, id DESC LIMIT ?", limit);
  }

  // ---------- Sorties d'argent (discipline financière) ----------

  addExpense(e: { amount: number; category: ExpenseCategory; spent_on: string; note?: string }): number {
    return this.run(
      "INSERT INTO expenses (amount, category, spent_on, note, created_at) VALUES (?, ?, ?, ?, ?)",
      e.amount,
      e.category,
      e.spent_on,
      e.note ?? "",
      now(),
    ).id;
  }

  expensesBetween(fromDay: string, toDay: string): Record<ExpenseCategory, number> & { total: number } {
    const rows = this.all<{ category: ExpenseCategory; s: number }>(
      "SELECT category, SUM(amount) AS s FROM expenses WHERE spent_on >= ? AND spent_on <= ? GROUP BY category",
      fromDay,
      toDay,
    );
    const out = { reinvestissement: 0, charges: 0, salaire: 0, perso: 0, total: 0 };
    for (const r of rows) {
      out[r.category] = r.s;
      out.total += r.s;
    }
    return out;
  }

  // ---------- Rappels ----------

  addReminder(dueAtIso: string, message: string, prospectId: number | null = null): number {
    return this.run(
      "INSERT INTO reminders (due_at, message, prospect_id, created_at) VALUES (?, ?, ?, ?)",
      dueAtIso,
      message,
      prospectId,
      now(),
    ).id;
  }

  dueReminders(atIso: string): Reminder[] {
    return this.all<Reminder>("SELECT * FROM reminders WHERE done = 0 AND due_at <= ? ORDER BY due_at", atIso);
  }

  upcomingReminders(limit = 10): Reminder[] {
    return this.all<Reminder>("SELECT * FROM reminders WHERE done = 0 ORDER BY due_at LIMIT ?", limit);
  }

  completeReminder(id: number): void {
    this.run("UPDATE reminders SET done = 1 WHERE id = ?", id);
  }

  // ---------- Mémoire long terme ----------

  remember(category: string, fact: string): number {
    return this.run("INSERT INTO memory (category, fact, created_at) VALUES (?, ?, ?)", category, fact, now()).id;
  }

  forget(id: number): boolean {
    return this.run("DELETE FROM memory WHERE id = ?", id).changes > 0;
  }

  memories(): { id: number; category: string; fact: string }[] {
    return this.all("SELECT id, category, fact FROM memory ORDER BY category, id");
  }

  // ---------- Conversation avec le propriétaire ----------

  addOwnerChat(role: "owner" | "agent" | "event", content: string): void {
    this.run("INSERT INTO owner_chat (role, content, created_at) VALUES (?, ?, ?)", role, content, now());
  }

  recentOwnerChat(limit: number): { role: string; content: string; created_at: string }[] {
    return this.all<{ role: string; content: string; created_at: string }>(
      `SELECT role, content, created_at FROM (
         SELECT * FROM owner_chat ORDER BY id DESC LIMIT ?
       ) ORDER BY id ASC`,
      limit,
    );
  }

  // ---------- Activité terrain ----------

  logActivity(a: {
    day: string;
    contacted?: number;
    calls?: number;
    visits?: number;
    meetings?: number;
    proposals?: number;
    notes?: string;
  }): void {
    this.run(
      `INSERT INTO activities (day, contacted, calls, visits, meetings, proposals, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      a.day,
      a.contacted ?? 0,
      a.calls ?? 0,
      a.visits ?? 0,
      a.meetings ?? 0,
      a.proposals ?? 0,
      a.notes ?? "",
      now(),
    );
  }

  activitySince(day: string): Record<string, number> {
    return (
      this.get<Record<string, number>>(
        `SELECT COALESCE(SUM(contacted),0) AS contacted, COALESCE(SUM(calls),0) AS calls, COALESCE(SUM(visits),0) AS visits,
                COALESCE(SUM(meetings),0) AS meetings, COALESCE(SUM(proposals),0) AS proposals
         FROM activities WHERE day >= ?`,
        day,
      ) ?? {}
    );
  }

  // ---------- Objectif ----------

  activeGoal(): Goal | undefined {
    return this.get<Goal>("SELECT id, label, amount, start_day, deadline FROM goals WHERE active = 1 ORDER BY id DESC LIMIT 1");
  }

  setGoal(g: { label: string; amount: number; start_day: string; deadline: string }): number {
    return this.transaction(() => {
      this.run("UPDATE goals SET active = 0 WHERE active = 1");
      return this.run(
        "INSERT INTO goals (label, amount, start_day, deadline, created_at) VALUES (?, ?, ?, ?, ?)",
        g.label,
        g.amount,
        g.start_day,
        g.deadline,
        now(),
      ).id;
    });
  }

  // ---------- Clé / valeur ----------

  kvGet(key: string): string | undefined {
    return this.get<{ value: string }>("SELECT value FROM kv WHERE key = ?", key)?.value;
  }

  kvSet(key: string, value: string): void {
    this.run("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
  }
}
