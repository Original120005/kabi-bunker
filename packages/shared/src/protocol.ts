import { z } from "zod";

const Id = z.string().min(1).max(64);
/** A player id or "all" for every player still in the camp. */
const Target = Id;
const Key = z.string().min(1).max(40);
const Text = z.string().trim().min(1).max(700);

/** Host panel tools. They only change the game; nothing is applied automatically from card texts. */
export const HostAction = z.discriminatedUnion("type", [
  z.object({ type: z.literal("host.exile"), playerId: Id }),
  z.object({ type: z.literal("host.return"), playerId: Id }),
  z.object({ type: z.literal("host.seats"), delta: z.union([z.literal(1), z.literal(-1)]) }),
  z.object({ type: z.literal("host.catastrophe.reroll") }),
  z.object({ type: z.literal("host.char.reroll"), target: Target, charKey: Key }),
  z.object({ type: z.literal("host.modifier.set"), target: Target, charKey: Key, modifierKey: Key, level: Key }),
  z.object({ type: z.literal("host.gender.flip"), target: Target }),
  z.object({ type: z.literal("host.char.swap"), a: Id, b: Id, charKey: Key }),
  z.object({ type: z.literal("host.char.shuffle"), charKey: Key }),
  z.object({ type: z.literal("host.char.steal"), thief: Id, victim: Id, charKey: Key }),
  z.object({ type: z.literal("host.cure"), target: Target, op: z.enum(["healthy", "childfree", "cureChildfree", "curePhobia"]) }),
  z.object({ type: z.literal("host.ageGroup"), target: Target, group: Key }),
  z.object({ type: z.literal("host.body"), target: Target, title: Key }),
  z.object({ type: z.literal("host.char.add"), target: Id, charKey: Key, text: Text.optional() }),
  z.object({ type: z.literal("host.char.remove"), target: Id, charKey: Key }),
  z.object({ type: z.literal("host.char.toBunker"), target: Id, charKey: Key }),
  z.object({ type: z.literal("host.rotate"), charKey: Key, dir: z.enum(["cw", "ccw"]) }),
  z.object({ type: z.literal("host.nullify"), charKey: Key }),
  z.object({ type: z.literal("host.bunker.reroll"), field: Key }),
  z.object({ type: z.literal("host.bunker.set"), field: Key, text: Text }),
  z.object({ type: z.literal("host.bunker.addItem"), text: Text.optional() }),
  z.object({ type: z.literal("host.revealAll") }),
  /** One-click application of an opened special card; target and charKey depend on the card's effect. */
  z.object({ type: z.literal("host.special.apply"), cardId: Id, target: Id.optional(), charKey: Key.optional() }),
  z.object({ type: z.literal("host.dice"), sides: z.union([z.literal(6), z.literal(20)]) }),
  z.object({
    type: z.literal("host.message"),
    to: Target,
    color: z.enum(["gold", "green", "red", "white"]),
    title: z.string().trim().max(80),
    text: Text,
  }),
  z.object({ type: z.literal("host.timer"), seconds: z.union([z.literal(15), z.literal(30), z.literal(60)]) }),
  z.object({ type: z.literal("host.timer.stop") }),
  /** Candidates are the players put up for the vote by the host. */
  z.object({ type: z.literal("host.vote.start"), candidates: z.array(Id).min(1).max(30) }),
  z.object({ type: z.literal("host.vote.finish") }),
  z.object({ type: z.literal("host.vote.clear") }),
  z.object({ type: z.literal("host.raid.start") }),
  /** «Игрок вернулся»: rolls survival and loot, then the room watches the roulettes. */
  z.object({ type: z.literal("host.raid.return") }),
  z.object({ type: z.literal("host.raid.cancel") }),
  /** Closes the final results for everyone. */
  z.object({ type: z.literal("host.raid.clear") }),
  /** Shows one random bunker event to everyone. Does not change cards, health or supplies. */
  z.object({ type: z.literal("host.event") }),
  z.object({ type: z.literal("host.transfer"), participantId: Id }),
  z.object({ type: z.literal("host.undo") }),
  z.object({ type: z.literal("host.restart") }),
  /** Scores the party once: bunker +20, first exile −20, second exile −10. */
  z.object({ type: z.literal("host.finish") }),
]);
export type HostAction = z.infer<typeof HostAction>;

export const ClientAction = z.discriminatedUnion("type", [
  ...HostAction.options,
  z.object({ type: z.literal("lobby.setHostPlays"), value: z.boolean() }),
  z.object({ type: z.literal("lobby.setAutoStart"), value: z.boolean() }),
  z.object({ type: z.literal("lobby.kick"), participantId: z.string(), ban: z.boolean() }),
  z.object({ type: z.literal("lobby.unban"), id: z.string() }),
  z.object({ type: z.literal("lobby.leave") }),
  z.object({ type: z.literal("lobby.startReadyCheck") }),
  z.object({ type: z.literal("lobby.cancelReadyCheck") }),
  z.object({ type: z.literal("lobby.setReady"), ready: z.boolean() }),
  z.object({ type: z.literal("lobby.start") }),
  z.object({ type: z.literal("room.close") }),
  z.object({ type: z.literal("card.setRevealed"), cardId: z.string(), revealed: z.boolean() }),
  z.object({ type: z.literal("vote.cast"), candidateId: Id }),
  z.object({ type: z.literal("raid.answer"), yes: z.boolean() }),
]);
export type ClientAction = z.infer<typeof ClientAction>;

export const NICKNAME_MAX = 32;

/** Humans authenticate with the session cookie. The bot script sends a server secret instead of a Discord account. */
export const JoinAuth = z.object({
  code: z.string().min(4).max(10),
  token: z.string().min(16).max(128).optional(),
  nickname: z.string().trim().min(1).max(NICKNAME_MAX).optional(),
  botSecret: z.string().min(1).max(128).optional(),
});
export type JoinAuth = z.infer<typeof JoinAuth>;

export type ActionAck = { ok: true } | { ok: false; error: string };

export const SocketEvents = {
  state: "state",
  action: "action",
  kicked: "kicked",
  error: "server-error",
} as const;
