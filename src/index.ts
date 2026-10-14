// Point d'entrée : npm start (WhatsApp) ou npm run simulate (console).

import { join } from "node:path";
import { Agent } from "./agent.ts";
import { config } from "./config.ts";
import { Store } from "./db.ts";
import { Router } from "./router.ts";
import { Scheduler } from "./scheduler.ts";
import { makeTranscriber } from "./transcribe.ts";
import { SimulatorTransport } from "./transport/simulator.ts";
import type { Transport } from "./transport/types.ts";
import { WhatsAppTransport } from "./transport/whatsapp.ts";

const simulate = process.argv.includes("--simulate");

if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.error("❌ ANTHROPIC_API_KEY manquante : copie .env.example vers .env et renseigne ta clé (console.anthropic.com).");
  process.exit(1);
}

// Base séparée pour le simulateur : tes tests ne polluent pas ton vrai CRM.
const store = new Store(join(config.dataDir, simulate ? "simulation.db" : "agent.db"));
if (!store.activeGoal()) {
  store.setGoal({
    label: `${config.goalAmount.toLocaleString("fr-FR")} ${config.currency} encaissés`,
    amount: config.goalAmount,
    start_day: config.goalStart,
    deadline: config.goalDeadline,
  });
}

const transport: Transport = simulate ? new SimulatorTransport() : new WhatsAppTransport(config);
const agent = new Agent(store, config, transport);
const router = new Router(store, config, transport, agent, makeTranscriber(config));
const scheduler = new Scheduler(store, config, transport, agent);

console.log(`🚀 ${config.agentName} démarre (${transport.name}, modèle ${config.model})`);
await transport.start(router.onMessage);
scheduler.start();

const shutdown = () => {
  scheduler.stop();
  store.db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
