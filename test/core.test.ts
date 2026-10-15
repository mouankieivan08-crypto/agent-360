import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "../src/config.ts";
import { Store } from "../src/db.ts";
import { isOptOut, normalizePhone, renderTemplate, splitForWhatsApp } from "../src/text.ts";
import { localDay, parseLocal } from "../src/time.ts";
import { buildContext } from "../src/prompt.ts";
import { runTool, type ToolContext } from "../src/tools.ts";
import { FakeTransport } from "./helpers.ts";

const cfg = { ...config, defaultCountryCode: "242", timezone: "Africa/Brazzaville", dailySendLimit: 3 };

function ctx(store: Store, transport = new FakeTransport(), ownerTurn = true): ToolContext {
  return { store, cfg, transport, ownerTurn, now: new Date() };
}

test("normalizePhone : formats congolais et internationaux", () => {
  assert.equal(normalizePhone("06 123 45 67", "242"), "242061234567");
  assert.equal(normalizePhone("+242 06 123 45 67", "242"), "242061234567");
  assert.equal(normalizePhone("00242061234567", "242"), "242061234567");
  assert.equal(normalizePhone("+33 6 12 34 56 78", "242"), "33612345678");
  assert.equal(normalizePhone("123", "242"), null);
});

test("renderTemplate : variables, variantes et nettoyage", () => {
  const r = renderTemplate("{Bonjour|Salut} {{contact}}, chez {{entreprise}} à {{ville}} ?", {
    contact: "",
    entreprise: "Hôtel Olympic",
    ville: "Brazzaville",
  }, () => 0);
  assert.equal(r.text, "Bonjour, chez Hôtel Olympic à Brazzaville ?");
  assert.deepEqual(r.missing, ["contact"]);
});

test("isOptOut détecte les demandes d'arrêt sans faux positifs évidents", () => {
  for (const t of ["STOP", "Arrêtez de m'écrire svp", "ne m'écrivez plus", "Retirez mon numéro", "c'est du spam"]) {
    assert.ok(isOptOut(t), t);
  }
  for (const t of ["Oui intéressé, on peut se voir jeudi ?", "Quel est le prix ?", "Je ne peux pas aujourd'hui"]) {
    assert.ok(!isOptOut(t), t);
  }
});

test("parseLocal : heure de Brazzaville (UTC+1) -> UTC", () => {
  assert.equal(parseLocal("2026-10-15T09:00", "Africa/Brazzaville")?.toISOString(), "2026-10-15T08:00:00.000Z");
  assert.equal(parseLocal("2026-10-15T09:00Z", "Africa/Brazzaville")?.toISOString(), "2026-10-15T09:00:00.000Z");
  assert.equal(localDay(new Date("2026-10-14T23:30:00Z"), "Africa/Brazzaville"), "2026-10-15");
});

test("splitForWhatsApp coupe les messages trop longs", () => {
  const parts = splitForWhatsApp(`${"a".repeat(30)}\n\n${"b".repeat(30)}`, 40);
  assert.deepEqual(parts, ["a".repeat(30), "b".repeat(30)]);
});

test("prospects : ajout, doublons, recherche, mise à jour", async () => {
  const store = new Store(":memory:");
  const r = (await runTool(
    "add_prospects",
    {
      prospects: [
        { company: "Clinique Alpha", phone: "06 111 11 11", sector: "santé", city: "Brazzaville" },
        { company: "Clinique Alpha bis", phone: "+242061111111" },
        { company: "École Beta", phone: "05 222 22 22", sector: "éducation", city: "Pointe-Noire" },
        { company: "Sans numéro" },
      ],
    },
    ctx(store),
  )) as { ajoutes: number; doublons: number; sans_numero: number };
  assert.equal(r.ajoutes, 3);
  assert.equal(r.doublons, 1);
  assert.equal(r.sans_numero, 1);

  const found = (await runTool("search_prospects", { sector: "santé" }, ctx(store))) as { total: number };
  assert.equal(found.total, 1);

  await runTool("update_prospect", { prospect_id: 1, status: "meeting", note: "RDV jeudi 10h" }, ctx(store));
  const p = store.getProspect(1);
  assert.equal(p?.status, "meeting");
  assert.match(p?.notes ?? "", /RDV jeudi 10h/);
});

test("campagne : préparation sans envoi, lancement réservé au propriétaire", async () => {
  const store = new Store(":memory:");
  const transport = new FakeTransport();
  await runTool(
    "add_prospects",
    {
      prospects: [
        { company: "A", phone: "061000001", contact_name: "M. Jean Malonga" },
        { company: "B", phone: "061000002" },
        { company: "C", phone: "061000003" },
      ],
    },
    ctx(store, transport),
  );
  const c = (await runTool(
    "create_campaign",
    { name: "Pointage", message_template: "Bonjour {{prenom}}, {{entreprise}} suit les retards ?" },
    ctx(store, transport),
  )) as { campaign_id: number; destinataires: number; exemples: { message: string }[] };
  assert.equal(c.destinataires, 3);
  assert.equal(c.exemples[0]?.message, "Bonjour Jean, A suit les retards ?");
  assert.equal(transport.sent.length, 0, "rien n'est envoyé à la préparation");

  // Un prospect ne peut pas être dans deux campagnes actives en même temps.
  const dup = (await runTool("create_campaign", { name: "Doublon", message_template: "x" }, ctx(store, transport))) as {
    erreur?: string;
  };
  assert.ok(dup.erreur);

  await assert.rejects(
    runTool("launch_campaign", { campaign_id: c.campaign_id }, ctx(store, transport, false)),
    /approbation/,
  );
  const launched = (await runTool("launch_campaign", { campaign_id: c.campaign_id }, ctx(store, transport))) as {
    total_en_file: number;
  };
  assert.equal(launched.total_en_file, 3);
  assert.equal(store.getProspect(1)?.status, "queued");
});

test("envoi direct : refusé hors tour du propriétaire et pour les désinscrits", async () => {
  const store = new Store(":memory:");
  const transport = new FakeTransport();
  await runTool("add_prospects", { prospects: [{ company: "A", phone: "061000001" }] }, ctx(store, transport));
  await assert.rejects(
    runTool("send_whatsapp_message", { prospect_id: 1, text: "Bonjour" }, ctx(store, transport, false)),
    /approbation/,
  );
  await runTool("send_whatsapp_message", { prospect_id: 1, text: "Bonjour" }, ctx(store, transport));
  assert.equal(transport.sent.length, 1);
  assert.equal(store.getProspect(1)?.status, "contacted");

  await runTool("update_prospect", { prospect_id: 1, status: "do_not_contact" }, ctx(store, transport));
  await assert.rejects(
    runTool("send_whatsapp_message", { prospect_id: 1, text: "Relance" }, ctx(store, transport)),
    /ne plus être contacté/,
  );
});

test("finances : deals, MRR, encaissements et progression vers l'objectif", async () => {
  const store = new Store(":memory:");
  store.setGoal({ label: "5M", amount: 5_000_000, start_day: "2026-01-01", deadline: "2026-12-31" });
  await runTool(
    "record_deal",
    { client_name: "Clinique Alpha", offer: "Pointage", setup_amount: 150_000, monthly_amount: 45_000, stage: "won" },
    ctx(store),
  );
  assert.equal(store.mrr(), 45_000);
  const pay = (await runTool(
    "record_payment",
    { client_name: "Clinique Alpha", amount: 250_000, kind: "one_shot", paid_on: "2026-10-10" },
    ctx(store),
  )) as { encaisse_objectif: number; pourcentage: number };
  assert.equal(pay.encaisse_objectif, 250_000);
  assert.equal(pay.pourcentage, 5);
  await assert.rejects(runTool("record_payment", { client_name: "X", amount: -5, kind: "one_shot" }, ctx(store)));
});

test("rappels : refus des dates passées, enregistrement des dates futures", async () => {
  const store = new Store(":memory:");
  await assert.rejects(runTool("schedule_reminder", { due_at: "2020-01-01T09:00", message: "x" }, ctx(store)), /passée/);
  const r = (await runTool("schedule_reminder", { due_at: "2099-01-01T09:00", message: "RDV" }, ctx(store))) as {
    reminder_id: number;
  };
  assert.equal(store.upcomingReminders()[0]?.id, r.reminder_id);
  assert.equal(store.dueReminders("2099-01-01T08:00:00.000Z").length, 1);
});

test("discipline financière : sorties d'argent et réserve", async () => {
  const store = new Store(":memory:");
  store.setGoal({ label: "5M", amount: 5_000_000, start_day: "2026-01-01", deadline: "2026-12-31" });
  store.addPayment({ client_name: "Projets 2026", amount: 1_000_000, kind: "one_shot", paid_on: "2026-06-01" });
  const r = (await runTool("record_expense", { amount: 700_000, category: "perso", spent_on: "2026-06-15" }, ctx(store))) as {
    reserve: number;
  };
  assert.equal(r.reserve, 300_000);
  await runTool("record_expense", { amount: 100_000, category: "reinvestissement", spent_on: "2026-07-01" }, ctx(store));
  await assert.rejects(runTool("record_expense", { amount: 5_000, category: "fete" }, ctx(store)), /Catégorie/);
  assert.deepEqual(store.expensesBetween("2026-01-01", "2026-12-31"), {
    reinvestissement: 100_000,
    charges: 0,
    salaire: 0,
    perso: 700_000,
    total: 800_000,
  });
  assert.match(buildContext(store, cfg, new Date("2026-10-15T09:00:00Z")), /réserve théorique 200 000 FCFA/);
});
