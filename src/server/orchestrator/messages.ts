import { db } from "@/server/db";
import { emitEvent } from "@/server/events/store";
import { saveMemory, retrieveMemory } from "@/server/memory";
import { OrchestratorError } from "./errors";

/**
 * Structured inter-agent mail (SPEC §4.6).
 *
 * Messages are persisted twice, deliberately:
 * - as run-scope memory items (durable, retrievable context for later steps), and
 * - as AGENT_MESSAGE events (live stream + Time Machine).
 */

export interface AgentMail {
  from: string; // sender agent id
  fromName: string;
  to: string; // agent id, role name, "coordinator", or "all"
  summary: string;
  payload: Record<string, unknown>;
  confidence: number;
  requestedAction: string;
  timestamp: string; // ISO
}

const MAIL_KEY_PREFIX = "mail_";

export async function sendAgentMessage(m: {
  runId: string;
  fromAgentId: string;
  to: string;
  summary: string;
  payload?: Record<string, unknown>;
  confidence?: number;
  requestedAction?: string;
}): Promise<AgentMail> {
  const run = await db.agentRun.findUnique({
    where: { id: m.runId },
    include: { project: { select: { workspaceId: true } } },
  });
  if (!run) throw new OrchestratorError("run_not_found", `Run ${m.runId} not found`);
  const sender = await db.agent.findUnique({ where: { id: m.fromAgentId } });

  const mail: AgentMail = {
    from: m.fromAgentId,
    fromName: sender?.name ?? m.fromAgentId,
    to: m.to,
    summary: m.summary,
    payload: m.payload ?? {},
    confidence: Math.min(1, Math.max(0, m.confidence ?? 0.5)),
    requestedAction: m.requestedAction ?? "",
    timestamp: new Date().toISOString(),
  };

  await saveMemory({
    workspaceId: run.project.workspaceId,
    projectId: run.projectId,
    runId: m.runId,
    agentId: m.fromAgentId,
    scope: "run",
    key: `${MAIL_KEY_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    content: JSON.stringify(mail),
  });

  await emitEvent({
    runId: m.runId,
    projectId: run.projectId,
    type: "AGENT_MESSAGE",
    actorType: "agent",
    actorId: m.fromAgentId,
    summary: `${mail.fromName} → ${m.to}: ${m.summary}`.slice(0, 200),
    payload: {
      from: mail.from,
      to: mail.to,
      summary: mail.summary,
      payload: mail.payload,
      confidence: mail.confidence,
      requestedAction: mail.requestedAction,
      timestamp: mail.timestamp,
    },
  });

  return mail;
}

/**
 * Recent mail addressed to an agent (by id, name, or role — the model may
 * address any of them), plus broadcasts ("all"). Chronological order.
 */
export async function inboxFor(agentId: string, opts?: { limit?: number }): Promise<AgentMail[]> {
  const agent = await db.agent.findUnique({
    where: { id: agentId },
    include: { run: { include: { project: { select: { workspaceId: true } } } } },
  });
  if (!agent) throw new OrchestratorError("agent_not_found", `Agent ${agentId} not found`);

  const items = await retrieveMemory({
    workspaceId: agent.run.project.workspaceId,
    scopes: ["run"],
    runId: agent.runId,
    limit: 200,
  });

  const wanted = new Set(
    [agent.id, agent.name, agent.role, "all"].map((s) => s.toLowerCase()),
  );
  const mails: AgentMail[] = [];
  for (const item of items) {
    if (!item.key.startsWith(MAIL_KEY_PREFIX)) continue;
    try {
      const mail = JSON.parse(item.content) as AgentMail;
      if (mail && typeof mail.to === "string" && wanted.has(mail.to.toLowerCase())) {
        mails.push(mail);
      }
    } catch {
      // not a mail payload — ignore
    }
  }
  mails.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const limit = opts?.limit ?? 50;
  return mails.slice(-limit);
}
