import { RAID, formatCardLabel, type CardView, type GameView, type ModifierView, type ParticipantView, type RaidView, type RoomView, type VoteView } from "@bunker/shared";
import type { Card, GameState, Participant, Raid, RoomState, Vote } from "./types.ts";

/**
 * Builds the view for one participant. This is the only way state leaves the server:
 * values of closed cards are included only for their owner (and for the host when the rules allow it).
 */
export function projectRoom(state: RoomState, viewerId: string | null, online: ReadonlySet<string>, now: number): RoomView {
  const viewer = state.participants.find((p) => p.id === viewerId) ?? null;
  const toView = (p: Participant): ParticipantView => ({
    id: p.id,
    nickname: p.nickname,
    avatarUrl: p.avatarUrl ?? null,
    role: p.role,
    isHost: p.isHost,
    ready: p.ready,
    online: online.has(p.id),
  });
  return {
    code: state.code,
    version: state.version,
    status: state.status,
    serverTime: now,
    me: viewer ? toView(viewer) : null,
    settings: {
      hostPlays: state.settings.hostPlays,
      autoStart: state.settings.autoStart,
      minPlayers: state.rules.players.min,
      maxPlayers: state.rules.players.max,
      packSlugs: state.settings.packSlugs,
    },
    participants: state.participants.map(toView),
    banned: viewer?.isHost ? state.banned.map((b) => ({ id: b.id, nickname: b.nickname })) : [],
    game: state.game ? projectGame(state, state.game, viewer) : null,
    log: viewer?.isHost ? state.log.slice(-100) : [],
    notices: (state.notices ?? [])
      .filter((n) => n.to === "all" || n.to === viewerId)
      .map((n) => ({ id: n.id, at: n.at, color: n.color, title: n.title, text: n.text })),
    timer: state.timer ? { id: state.timer.id, seconds: state.timer.seconds, endsAt: state.timer.endsAt } : null,
    vote: state.vote ? projectVote(state.vote, viewerId) : null,
    raid: state.raid ? projectRaid(state.raid, viewerId, now) : null,
    event: projectEvent(state),
  };
}

function projectEvent(state: RoomState): RoomView["event"] {
  const event = state.event;
  if (!event) return null;
  const spin = event.spin;
  return {
    id: event.id,
    title: event.title,
    text: event.text,
    tone: event.tone,
    image: event.image ?? "",
    spin: spin
      ? { at: spin.at, reel: spin.reel, offset: spin.offset, effect: { kind: spin.effect.kind, title: spin.effect.title } }
      : null,
  };
}

/** Steps are sent only once their animation starts and the loot only at the end, so nobody can peek ahead. */
function projectRaid(r: Raid, viewerId: string | null, now: number): RaidView {
  const done = r.stage === "done";
  const spinning = r.stage === "picking" && (!r.pick || now < r.pick.at + RAID.pickSpinMs);
  return {
    id: r.id,
    stage: r.stage,
    votingEndsAt: r.votingEndsAt,
    eligible: r.eligible,
    volunteers: r.eligible.filter((id) => r.answers[id] === true),
    answered: Object.keys(r.answers),
    myAnswer: viewerId && viewerId in r.answers ? r.answers[viewerId] : null,
    playerId: spinning ? null : r.playerId,
    pick: r.pick ?? null,
    survival: r.survival ?? null,
    steps: r.steps.slice(0, r.revealed),
    survived: done ? (r.survived ?? null) : null,
    loot: done ? r.loot : [],
  };
}

function projectVote(vote: Vote, viewerId: string | null): VoteView {
  const closed = vote.status === "closed";
  return {
    id: vote.id,
    status: vote.status,
    candidates: vote.candidates,
    voters: vote.voters,
    voted: Object.keys(vote.ballots),
    myVote: viewerId ? (vote.ballots[viewerId] ?? null) : null,
    results: closed
      ? vote.candidates
          .map((candidateId) => ({ candidateId, voters: Object.keys(vote.ballots).filter((v) => vote.ballots[v] === candidateId) }))
          .sort((a, b) => b.voters.length - a.voters.length)
      : null,
  };
}

function projectGame(state: RoomState, game: GameState, viewer: Participant | null): GameView {
  const hostSees = viewer?.isHost === true && game.rules.hostSeesHidden;
  const cardView = (card: Card): CardView => {
    const visible = card.revealed || card.ownerId === viewer?.id || hostSees;
    if (!visible) return { id: card.id, charKey: card.charKey, hidden: true };
    const def = game.characteristics.find((c) => c.key === card.charKey);
    return {
      id: card.id,
      charKey: card.charKey,
      hidden: false,
      label: formatCardLabel(def, card.title, card.modifiers),
      title: card.title,
      description: card.description,
      link: card.link ?? null,
      abilities: card.abilities.map((a) => ({ name: a.name, text: a.text, kind: a.kind })),
      revealed: card.revealed,
      effect: card.effect ?? null,
      used: card.used === true,
    };
  };

  return {
    catastrophe: {
      title: game.catastrophe.title,
      description: game.catastrophe.description,
      population: game.catastrophe.population,
      timerMinutes: game.catastrophe.timerMinutes,
      image: game.catastrophe.image ?? null,
    },
    bunker: {
      seats: game.bunker.seats,
      fields: game.bunkerFields.map((f) => ({
        key: f.key,
        name: f.name,
        placement: f.placement,
        icon: f.icon,
        values: (game.bunker.fields[f.key] ?? []).map((v) => v.title),
      })),
    },
    characteristics: game.characteristics.map((c) => ({
      key: c.key,
      name: c.name,
      sort: c.sort,
      revealable: c.revealable,
      specialCard: c.specialCard,
      countPerPlayer: c.countPerPlayer,
      hint: c.hint,
      levels: c.modifiers.flatMap((m) => (m.kind === "scale" && m.ageBound ? m.levels.map((l) => ({ label: l.label, hint: l.hint })) : [])),
      modifiers: c.modifiers.map((m): ModifierView => {
        switch (m.kind) {
          case "scale":
            return { kind: "scale", key: m.key, levels: m.levels.map((l) => ({ key: l.key, label: l.label })) };
          case "age":
            return { kind: "age", key: m.key, groups: m.groups.map((g) => ({ key: g.key, label: g.label })) };
          case "flag":
            return { kind: "flag", key: m.key, label: m.label };
          case "range":
            return { kind: "range", key: m.key };
        }
      }),
    })),
    host: viewer?.isHost ? { bodies: game.bodies ?? [], undoLabel: state.undo?.at(-1)?.label ?? null } : null,
    settled: game.settlement != null,
    players: game.seatOrder.map((id, index) => {
      const hand = game.hands[id] ?? {};
      const person = state.participants.find((p) => p.id === id);
      const cards: Record<string, CardView[]> = {};
      for (const c of game.characteristics) cards[c.key] = (hand[c.key] ?? []).map((cid) => cardView(game.cards[cid]));
      return {
        id,
        seat: index + 1,
        nickname: person?.nickname ?? "Игрок",
        avatarUrl: person?.avatarUrl ?? null,
        status: game.statuses[id],
        cards,
      };
    }),
  };
}
