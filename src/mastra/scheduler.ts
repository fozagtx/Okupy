import { respond } from "./respond.js";
import { reminderStore, type Reminder } from "./reminders.js";
import { spectrumSend } from "./spectrum-state.js";
import { photonStatus } from "./photon.js";

const SCHEDULER_INTERVAL_MS = 30_000;

let timer: NodeJS.Timeout | null = null;

async function deliver(reminder: Reminder): Promise<void> {
  const prompt = `Reminder fired: ${reminder.message}` +
    (reminder.eventTitle ? ` (event: ${reminder.eventTitle})` : "") +
    (reminder.eventUrl ? ` ${reminder.eventUrl}` : "");
  let reply = prompt;
  let channel = "log";
  try {
    const result = await respond(reminder.userId, prompt);
    reply = result.reply;
    if (photonStatus() === "ready") {
      const sent = await spectrumSend(reminder.userId, reply);
      channel = sent ? "imessage" : "log";
    } else {
      console.log(`[scheduler] reminder fired for ${reminder.userId}: ${reply}`);
    }
  } catch (error) {
    console.error(`[scheduler] reminder delivery failed for ${reminder.id}`, error);
  } finally {
    try {
      await reminderStore.markFired(reminder.id, new Date());
      await reminderStore.recordDelivery(reminder.id, reminder.userId, reply, channel);
    } catch (error) {
      console.error(`[scheduler] reminder persistence failed for ${reminder.id}`, error);
    }
  }
}

async function tick(): Promise<void> {
  const due = await reminderStore.listDue(new Date());
  if (due.length === 0) return;
  await Promise.all(due.map(deliver));
}

export function startScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch(error => console.error("[scheduler] tick failed", error));
  }, SCHEDULER_INTERVAL_MS);
  void tick().catch(error => console.error("[scheduler] initial tick failed", error));
}

export function stopScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}