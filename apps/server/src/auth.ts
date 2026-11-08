import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { NICKNAME_MAX, survivalPercent, type Settlement } from "@bunker/shared";
import { GameError } from "@bunker/engine";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "./db.ts";

const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const SID = "bunker_sid";
const STATE = "oauth_state";
const NEXT = "oauth_next";

export interface PublicUser {
  displayName: string;
  username: string;
  avatarUrl: string | null;
  rating: number;
  games: number;
  bunkerEntries: number;
  survivalPercent: number;
}

export interface MemberIdentity {
  token: string;
  nickname: string;
  profileId: string | null;
  avatarUrl: string | null;
}

export function discordConfigured(): boolean {
  return Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET);
}

export function botSecret(): string {
  return process.env.BOT_SECRET || "bunker-local-bots";
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

function cookieBase(req: FastifyRequest): string {
  return `Path=/; HttpOnly; SameSite=Lax${req.protocol === "https" ? "; Secure" : ""}`;
}

export function setCookies(reply: FastifyReply, cookies: string[]) {
  reply.raw.setHeader("Set-Cookie", cookies);
}

function clipName(name: string): string {
  const trimmed = name.trim().slice(0, NICKNAME_MAX);
  return trimmed || "Игрок";
}

function redirectUri(req: FastifyRequest): string {
  if (process.env.DISCORD_REDIRECT_URI) return process.env.DISCORD_REDIRECT_URI;
  const raw = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost";
  const host = Array.isArray(raw) ? raw[0] : raw;
  return `${req.protocol}://${host}/api/auth/discord/callback`;
}

export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || raw.includes("://")) return "/";
  if (raw === "/" || raw === "/leaders" || /^\/room\/[A-Z0-9]{4,10}$/.test(raw)) return raw;
  return "/";
}

function discordAvatar(id: string, avatar: string | null): string | null {
  if (!avatar) return null;
  const ext = avatar.startsWith("a_") ? "gif" : "png";
  return `https://cdn.discordapp.com/avatars/${id}/${avatar}.${ext}?size=128`;
}

function publicUser(player: { displayName: string; username: string; avatarUrl: string | null; rating: number; games: number; bunkerEntries: number; survivalPercent: number }): PublicUser {
  return {
    displayName: player.displayName,
    username: player.username,
    avatarUrl: player.avatarUrl,
    rating: player.rating,
    games: player.games,
    bunkerEntries: player.bunkerEntries,
    survivalPercent: player.survivalPercent,
  };
}

export async function sessionUser(req: FastifyRequest): Promise<PublicUser | null> {
  const raw = readCookie(req.headers.cookie, SID);
  if (!raw) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(raw) }, include: { player: true } });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  await prisma.session.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() + SESSION_MS) } }).catch(() => undefined);
  return publicUser(session.player);
}

/** Who is allowed into a room. Bots never receive a profile, so they cannot be written onto the leaderboard. */
export async function identityFromSocket(cookieHeader: string | undefined, auth: { token?: string; nickname?: string; botSecret?: string }): Promise<MemberIdentity> {
  if (auth.botSecret) {
    if (!sameSecret(auth.botSecret, botSecret())) throw new GameError("Вход без Discord недоступен");
    if (!auth.token || !auth.nickname) throw new GameError("Некорректные данные бота");
    return { token: auth.token, nickname: clipName(auth.nickname), profileId: null, avatarUrl: null };
  }
  const raw = readCookie(cookieHeader, SID);
  if (!raw) throw new GameError("Войдите через Discord");
  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(raw) }, include: { player: true } });
  if (!session || session.expiresAt.getTime() < Date.now()) throw new GameError("Войдите через Discord");
  const player = session.player;
  return { token: raw, nickname: clipName(player.displayName), profileId: player.id, avatarUrl: player.avatarUrl };
}

export async function beginDiscord(req: FastifyRequest, reply: FastifyReply) {
  if (!discordConfigured()) return reply.code(503).send({ error: "Discord не настроен. Добавьте DISCORD_CLIENT_ID и DISCORD_CLIENT_SECRET в файл .env." });
  const next = safeNext(typeof (req.query as { next?: string }).next === "string" ? (req.query as { next: string }).next : "/");
  const state = randomBytes(24).toString("base64url");
  const base = cookieBase(req);
  setCookies(reply, [`${STATE}=${state}; ${base}; Max-Age=600`, `${NEXT}=${encodeURIComponent(next)}; ${base}; Max-Age=600`]);
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", process.env.DISCORD_CLIENT_ID!);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri(req));
  url.searchParams.set("scope", "identify");
  url.searchParams.set("state", state);
  return reply.redirect(url.toString());
}

export async function finishDiscord(req: FastifyRequest, reply: FastifyReply) {
  const fail = () => {
    const base = cookieBase(req);
    setCookies(reply, [`${STATE}=; ${base}; Max-Age=0`, `${NEXT}=; ${base}; Max-Age=0`]);
    return reply.redirect("/?auth=failed");
  };
  if (!discordConfigured()) return fail();
  const query = req.query as { code?: string; state?: string };
  const expected = readCookie(req.headers.cookie, STATE);
  if (!query.code || !query.state || !expected || !sameSecret(query.state, expected)) return fail();
  const next = safeNext(readCookie(req.headers.cookie, NEXT));
  try {
    const body = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID!,
      client_secret: process.env.DISCORD_CLIENT_SECRET!,
      grant_type: "authorization_code",
      code: query.code,
      redirect_uri: redirectUri(req),
    });
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const tokenJson = (await tokenRes.json().catch(() => ({}))) as { access_token?: string };
    if (!tokenRes.ok || !tokenJson.access_token) return fail();
    const userRes = await fetch("https://discord.com/api/users/@me", { headers: { Authorization: `Bearer ${tokenJson.access_token}` } });
    const user = (await userRes.json().catch(() => null)) as { id?: string; username?: string; global_name?: string | null; avatar?: string | null } | null;
    if (!userRes.ok || !user?.id || !user.username) return fail();
    const displayName = clipName(user.global_name || user.username);
    const player = await prisma.player.upsert({
      where: { discordId: user.id },
      create: {
        discordId: user.id,
        username: user.username.slice(0, 32),
        displayName,
        nameKey: displayName.toLocaleLowerCase("ru-RU"),
        avatarUrl: discordAvatar(user.id, user.avatar ?? null),
      },
      update: {
        username: user.username.slice(0, 32),
        displayName,
        nameKey: displayName.toLocaleLowerCase("ru-RU"),
        avatarUrl: discordAvatar(user.id, user.avatar ?? null),
      },
    });
    const raw = randomBytes(32).toString("base64url");
    await prisma.session.create({ data: { tokenHash: hashToken(raw), playerId: player.id, expiresAt: new Date(Date.now() + SESSION_MS) } });
    const base = cookieBase(req);
    setCookies(reply, [`${SID}=${encodeURIComponent(raw)}; ${base}; Max-Age=${SESSION_MS / 1000}`, `${STATE}=; ${base}; Max-Age=0`, `${NEXT}=; ${base}; Max-Age=0`]);
    return reply.redirect(next);
  } catch (e) {
    console.error(`Discord: ${(e as Error).message}`);
    return fail();
  }
}

export async function logout(req: FastifyRequest, reply: FastifyReply) {
  const raw = readCookie(req.headers.cookie, SID);
  if (raw) await prisma.session.deleteMany({ where: { tokenHash: hashToken(raw) } });
  setCookies(reply, [`${SID}=; ${cookieBase(req)}; Max-Age=0`]);
  return { ok: true };
}

export async function leaderboard(query: string) {
  const q = query.trim().toLocaleLowerCase("ru-RU");
  const all = await prisma.player.findMany({
    orderBy: [{ rating: "desc" }, { games: "desc" }, { bunkerEntries: "desc" }, { displayName: "asc" }],
  });
  const ranked = all.map((p, i) => ({
    place: i + 1,
    displayName: p.displayName,
    avatarUrl: p.avatarUrl,
    games: p.games,
    survivalPercent: p.survivalPercent,
    rating: p.rating,
    nameKey: p.nameKey,
  }));
  const players = (q ? ranked.filter((p) => p.nameKey.includes(q)) : ranked).map(({ nameKey: _name, ...row }) => row);
  return { players, total: all.length };
}

export async function applyPartyResults(db: PrismaClient, settlement: Settlement) {
  const rows = settlement.rows.filter((r) => r.profileId);
  if (!rows.length) return;
  await db.$transaction(async (tx) => {
    for (const row of rows) {
      const playerId = row.profileId!;
      try {
        await tx.ratingGrant.create({
          data: { settlementId: settlement.id, playerId, delta: row.delta, bunker: row.outcome === "bunker" },
        });
      } catch (e) {
        if (typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002") continue;
        throw e;
      }
      const player = await tx.player.update({
        where: { id: playerId },
        data: {
          games: { increment: 1 },
          rating: { increment: row.delta },
          ...(row.outcome === "bunker" ? { bunkerEntries: { increment: 1 } } : {}),
        },
      });
      await tx.player.update({
        where: { id: playerId },
        data: { survivalPercent: survivalPercent(player.bunkerEntries, player.games) },
      });
    }
  });
}
