import { createHash, randomBytes, randomInt } from "node:crypto";
import { advanceRoom, applyAction, createRoom, GameError, joinRoom, nextWakeAt, projectRoom, upgradeRoom, type RoomState } from "@bunker/engine";
import type { ClientAction, RoomView } from "@bunker/shared";
import type { PrismaClient } from "@prisma/client";
import { applyPartyResults, type MemberIdentity } from "../auth.ts";
import type { ContentService } from "../content/service.ts";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 5;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newId(): string {
  return randomBytes(9).toString("base64url");
}

function newCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export interface Listener {
  participantId: string;
  send: (view: RoomView) => void;
  kick: (reason: string) => void;
}

interface LiveRoom {
  state: RoomState;
  /** Actions of a room are applied strictly one after another. */
  queue: Promise<unknown>;
  listeners: Set<Listener>;
  /** Pending time-driven transition (raid stages). */
  wake?: ReturnType<typeof setTimeout>;
}

export class RoomManager {
  private rooms = new Map<string, LiveRoom>();

  constructor(
    private prisma: PrismaClient,
    private content: ContentService,
  ) {}

  async restore() {
    const rows = await this.prisma.room.findMany({ where: { status: { not: "closed" } } });
    for (const r of rows) {
      try {
        const room: LiveRoom = { state: upgradeRoom(JSON.parse(r.state) as RoomState, (slugs) => this.content.build(slugs)), queue: Promise.resolve(), listeners: new Set() };
        this.rooms.set(r.code, room);
        this.schedule(room);
      } catch (e) {
        console.error(`Комната ${r.code} не восстановлена: ${(e as Error).message}`);
      }
    }
    return rows.length;
  }

  exists(code: string): RoomState["status"] | null {
    return this.rooms.get(code)?.state.status ?? null;
  }

  async create(member: MemberIdentity): Promise<string> {
    let code = newCode();
    while (this.rooms.has(code) || (await this.prisma.room.findUnique({ where: { code } }))) code = newCode();
    const state = createRoom({
      code,
      hostId: newId(),
      tokenHash: hashToken(member.token),
      nickname: member.nickname,
      profileId: member.profileId,
      avatarUrl: member.avatarUrl,
      now: Date.now(),
      seed: randomInt(2 ** 31),
      packSlugs: this.content.defaultPackSlugs(),
    });
    const room: LiveRoom = { state, queue: Promise.resolve(), listeners: new Set() };
    this.rooms.set(code, room);
    await this.persist(state);
    return code;
  }

  private enqueue<T>(room: LiveRoom, job: () => Promise<T>): Promise<T> {
    const run = room.queue.then(job, job);
    room.queue = run.catch(() => undefined);
    return run;
  }

  /** Arms a timer for the next time-driven transition; fires immediately if it is overdue (e.g. after a restart). */
  private schedule(room: LiveRoom) {
    if (room.wake) clearTimeout(room.wake);
    room.wake = undefined;
    const at = nextWakeAt(room.state);
    if (at === null) return;
    room.wake = setTimeout(() => {
      room.wake = undefined;
      this.enqueue(room, async () => {
        const next = advanceRoom(room.state, { now: Date.now(), newId });
        if (next !== room.state) {
          room.state = next;
          this.broadcast(room);
          await this.persist(next);
        }
        this.schedule(room);
      }).catch((e) => console.error(`Комната ${room.state.code}: ${(e as Error).message}`));
    }, Math.max(0, at - Date.now()) + 15);
  }

  private async persist(state: RoomState) {
    const data = { status: state.status, version: state.version, state: JSON.stringify(state) };
    await this.prisma.room.upsert({ where: { code: state.code }, create: { code: state.code, ...data }, update: data });
  }

  private online(room: LiveRoom): Set<string> {
    return new Set([...room.listeners].map((l) => l.participantId));
  }

  private broadcast(room: LiveRoom, removedReason = "Вы покинули комнату") {
    const online = this.online(room);
    const now = Date.now();
    const present = new Set(room.state.participants.map((p) => p.id));
    for (const l of room.listeners) {
      if (!present.has(l.participantId)) {
        room.listeners.delete(l);
        l.kick(room.state.banned.some((b) => b.id === l.participantId) ? "Ведущий исключил вас и запретил вход" : removedReason);
        continue;
      }
      l.send(projectRoom(room.state, l.participantId, online, now));
    }
  }

  /** Joins or reconnects by token and subscribes the listener. Returns the participant id. */
  async connect(code: string, member: MemberIdentity, makeListener: (participantId: string) => Listener): Promise<{ participantId: string; detach: () => void }> {
    const room = this.rooms.get(code);
    if (!room) throw new GameError("Комната не найдена");
    return this.enqueue(room, async () => {
      const { state, participantId, changed } = joinRoom(room.state, {
        id: newId(),
        tokenHash: hashToken(member.token),
        nickname: member.nickname,
        profileId: member.profileId,
        avatarUrl: member.avatarUrl,
        now: Date.now(),
      });
      if (changed) {
        room.state = state;
        await this.persist(state);
      }
      const listener = makeListener(participantId);
      room.listeners.add(listener);
      this.broadcast(room);
      return {
        participantId,
        detach: () => {
          if (room.listeners.delete(listener)) this.broadcast(room);
        },
      };
    });
  }

  async act(code: string, participantId: string, action: ClientAction): Promise<void> {
    const room = this.rooms.get(code);
    if (!room) throw new GameError("Комната не найдена");
    return this.enqueue(room, async () => {
      const previousSettlement = room.state.game?.settlement?.id ?? null;
      const next = applyAction(room.state, action, {
        actorId: participantId,
        now: Date.now(),
        newId,
        loadContent: (slugs) => this.content.build(slugs),
      });
      if (next === room.state) return;
      const settlement = next.game?.settlement;
      if (settlement && settlement.id !== previousSettlement) await applyPartyResults(this.prisma, settlement);
      room.state = next;
      this.broadcast(room, action.type === "lobby.kick" ? "Ведущий исключил вас из комнаты" : undefined);
      this.schedule(room);
      if (next.status === "closed") {
        for (const l of room.listeners) l.kick("Комната закрыта");
        room.listeners.clear();
        this.rooms.delete(code);
      }
      await this.persist(next);
      await this.prisma.actionLog.create({
        data: { roomCode: code, version: next.version, actorId: participantId, type: action.type, payload: JSON.stringify(action) },
      });
    });
  }
}
