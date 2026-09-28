export interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** Outgoing email. Swap ConsoleMailer for a real provider (SES, Postmark…) in production. */
export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export class ConsoleMailer implements Mailer {
  async send(mail: Mail) {
    console.info(`\n[mail] to ${mail.to}: ${mail.subject}\n${mail.text}\n`);
  }
}

/** Keeps sent mail in memory; used by tests. */
export class MemoryMailer implements Mailer {
  readonly sent: Mail[] = [];
  async send(mail: Mail) {
    this.sent.push(mail);
  }
}
