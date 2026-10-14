import type { OutreachStatus, Transport } from "../src/transport/types.ts";

/** Faux canal WhatsApp : enregistre les envois au lieu de les faire. */
export class FakeTransport implements Transport {
  readonly name = "fake";
  toOwner: string[] = [];
  sent: { phone: string; text: string }[] = [];
  noWhatsApp = new Set<string>();
  status: OutreachStatus = { blocked: false, reason: null, newChatQuotaLeft: null };
  async start() {}
  isReady() {
    return true;
  }
  async sendToOwner(text: string) {
    this.toOwner.push(text);
  }
  async sendToPhone(phone: string, text: string) {
    this.sent.push({ phone, text });
    return { id: `out-${this.sent.length}` };
  }
  async checkPhone(phone: string) {
    return !this.noWhatsApp.has(phone);
  }
  async outreachStatus() {
    return this.status;
  }
}
