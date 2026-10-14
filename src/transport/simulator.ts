// Simulateur console : teste l'agent sans WhatsApp (npm run simulate).
//   Tape un message           -> tu parles à l'agent (comme sur WhatsApp)
//   /prospect 2420612345 Oui  -> simule la réponse d'un prospect
//   /quit                     -> quitter

import { createInterface } from "node:readline";
import type { InboundMessage, OutreachStatus, Transport } from "./types.ts";

export class SimulatorTransport implements Transport {
  readonly name = "simulator";
  private counter = 0;

  async start(onMessage: (m: InboundMessage) => void): Promise<void> {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    console.log("💬 Simulateur prêt. Écris à ton agent. « /prospect <numéro> <texte> » simule un prospect, « /quit » pour sortir.\n");
    rl.on("line", (line) => {
      const text = line.trim();
      if (!text) return;
      if (text === "/quit") process.exit(0);
      const m = /^\/prospect\s+(\+?\d+)\s+(.+)$/s.exec(text);
      onMessage({
        id: `sim-${++this.counter}`,
        phone: m ? (m[1] ?? "").replace(/\D/g, "") : null,
        isSelfChat: !m,
        fromMe: !m,
        pushName: m ? "Prospect" : "Moi",
        text: m ? (m[2] ?? "") : text,
        media: null,
        download: null,
        timestamp: new Date(),
      });
    });
  }

  isReady(): boolean {
    return true;
  }

  async sendToOwner(text: string): Promise<void> {
    console.log(`\n🤖 ${text}\n`);
  }

  async sendToPhone(phone: string, text: string): Promise<{ id: string }> {
    console.log(`\n📤 → +${phone}\n${text}\n`);
    return { id: `sim-out-${++this.counter}` };
  }

  async checkPhone(): Promise<boolean> {
    return true;
  }

  async outreachStatus(): Promise<OutreachStatus> {
    return { blocked: false, reason: null, newChatQuotaLeft: null };
  }
}
