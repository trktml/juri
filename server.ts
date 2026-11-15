import { Database } from "bun:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface CriterionDef {
  key: "bilgi" | "sunum" | "emek" | "malzeme";
  label: string;
  shortLabel: string;
  description: string;
}

export const CRITERIA: CriterionDef[] = [
  {
    key: "bilgi",
    label: "Bilgilerin yeterliliği",
    shortLabel: "Bilgi Yeterliliği",
    description: "Konuya hakimiyet, içerik doğruluğu ve derinliği",
  },
  {
    key: "sunum",
    label: "Sunum becerisi",
    shortLabel: "Sunum Becerisi",
    description: "Anlatım akıcılığı, hitabet, zaman yönetimi ve sahne duruşu",
  },
  {
    key: "emek",
    label: "Hazırlanma emeği",
    shortLabel: "Hazırlanma Emeği",
    description: "Araştırma, prova, düzen ve ortaya konan çalışma yoğunluğu",
  },
  {
    key: "malzeme",
    label: "Malzeme kalitesi",
    shortLabel: "Malzeme Kalitesi",
    description: "Görsel materyal, maket, slayt veya destekleyici araçların niteliği",
  },
];

export type SortMode = "average" | "total";
export type TvMode = "leaderboard" | "spotlight";

export interface GroupSummary {
  id: number;
  name: string;
  topic: string;
  voteCount: number;
  criteriaAvg: {
    bilgi: number;
    sunum: number;
    emek: number;
    malzeme: number;
  };
  avgOutOf5: number;
  avgOutOf20: number;
  totalPoints: number;
  rank: number;
}

export interface VoteRecord {
  id: number;
  juryId: string;
  juryName: string;
  groupId: number;
  bilgi: number;
  sunum: number;
  emek: number;
  malzeme: number;
  totalScore: number;
  avgScore: number;
  updatedAt: string;
}

export interface JurySummary {
  juryId: string;
  juryName: string;
  votedGroupIds: number[];
  lastUpdated: string;
}

export interface AppSettings {
  activeGroupId: number;
  sortMode: SortMode;
  tvMode: TvMode;
}

export interface AppState {
  criteria: CriterionDef[];
  groups: GroupSummary[];
  leaderboard: GroupSummary[];
  votes: VoteRecord[];
  juries: JurySummary[];
  settings: AppSettings;
  stats: {
    totalVotes: number;
    uniqueJuries: number;
    groupsWithVotes: number;
  };
  network: {
    port: number;
    urls: string[];
  };
  serverTime: string;
}

export type BroadcastEvent =
  | {
      type: "VOTE_CAST";
      juryName: string;
      groupId: number;
      groupName: string;
      totalScore: number;
      avgScore: number;
      updated: boolean;
    }
  | {
      type: "GROUPS_UPDATED";
    }
  | {
      type: "SETTINGS_UPDATED";
      settings: AppSettings;
    }
  | {
      type: "VOTE_DELETED";
    }
  | {
      type: "DEMO_LOADED";
    }
  | {
      type: "RESET";
    };

export interface ServerOptions {
  dbPath?: string;
  port?: number;
  hostname?: string;
}

export function normalizeJuryId(name: string): string {
  return name.trim().toLocaleLowerCase("tr-TR").replace(/\s+/g, " ");
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isValidScore(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

function getLocalNetworkUrls(port: number): string[] {
  const interfaces = os.networkInterfaces();
  const urls: string[] = [];

  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family === "IPv4" && !entry.internal) {
        urls.push(`http://${entry.address}:${port}`);
      }
    }
  }

  return Array.from(new Set(urls));
}

function initDatabase(dbPath: string): Database {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");

  db.exec(`
    CREATE TABLE IF NOT EXISTS groups (
      id INTEGER PRIMARY KEY CHECK(id BETWEEN 1 AND 6),
      name TEXT NOT NULL,
      topic TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jury_id TEXT NOT NULL,
      jury_name TEXT NOT NULL,
      group_id INTEGER NOT NULL CHECK(group_id BETWEEN 1 AND 6),
      bilgi INTEGER NOT NULL CHECK(bilgi BETWEEN 1 AND 5),
      sunum INTEGER NOT NULL CHECK(sunum BETWEEN 1 AND 5),
      emek INTEGER NOT NULL CHECK(emek BETWEEN 1 AND 5),
      malzeme INTEGER NOT NULL CHECK(malzeme BETWEEN 1 AND 5),
      updated_at TEXT NOT NULL,
      UNIQUE(jury_id, group_id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const insertGroup = db.prepare(
    "INSERT OR IGNORE INTO groups (id, name, topic) VALUES (?1, ?2, ?3)"
  );
  for (let i = 1; i <= 6; i++) {
    insertGroup.run(i, `${i}. Grup`, "");
  }

  const insertSetting = db.prepare(
    "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)"
  );
  insertSetting.run("active_group_id", "0");
  insertSetting.run("sort_mode", "average");
  insertSetting.run("tv_mode", "leaderboard");

  return db;
}

function readSettings(db: Database): AppSettings {
  const rows = db.query("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  const map = new Map(rows.map((r) => [r.key, r.value]));

  const parsedGroup = Number.parseInt(map.get("active_group_id") ?? "0", 10);
  const activeGroupId =
    Number.isInteger(parsedGroup) && parsedGroup >= 0 && parsedGroup <= 6 ? parsedGroup : 0;

  const rawSort = map.get("sort_mode");
  const sortMode: SortMode = rawSort === "total" ? "total" : "average";

  const rawTvMode = map.get("tv_mode");
  const tvMode: TvMode = rawTvMode === "spotlight" ? "spotlight" : "leaderboard";

  return { activeGroupId, sortMode, tvMode };
}

function buildAppState(db: Database, port: number): AppState {
  const settings = readSettings(db);

  const groupRows = db
    .query("SELECT id, name, topic FROM groups ORDER BY id ASC")
    .all() as { id: number; name: string; topic: string }[];

  const voteRows = db
    .query(
      `SELECT id, jury_id, jury_name, group_id, bilgi, sunum, emek, malzeme, updated_at
       FROM votes
       ORDER BY updated_at DESC, id DESC`
    )
    .all() as {
    id: number;
    jury_id: string;
    jury_name: string;
    group_id: number;
    bilgi: number;
    sunum: number;
    emek: number;
    malzeme: number;
    updated_at: string;
  }[];

  const votes: VoteRecord[] = voteRows.map((row) => {
    const totalScore = row.bilgi + row.sunum + row.emek + row.malzeme;
    return {
      id: row.id,
      juryId: row.jury_id,
      juryName: row.jury_name,
      groupId: row.group_id,
      bilgi: row.bilgi,
      sunum: row.sunum,
      emek: row.emek,
      malzeme: row.malzeme,
      totalScore,
      avgScore: round2(totalScore / 4),
      updatedAt: row.updated_at,
    };
  });

  const votesByGroup = new Map<number, VoteRecord[]>();
  const juryMap = new Map<string, JurySummary>();

  for (const vote of votes) {
    const list = votesByGroup.get(vote.groupId) ?? [];
    list.push(vote);
    votesByGroup.set(vote.groupId, list);

    const existingJury = juryMap.get(vote.juryId);
    if (existingJury) {
      if (!existingJury.votedGroupIds.includes(vote.groupId)) {
        existingJury.votedGroupIds.push(vote.groupId);
      }
      if (vote.updatedAt > existingJury.lastUpdated) {
        existingJury.lastUpdated = vote.updatedAt;
        existingJury.juryName = vote.juryName;
      }
    } else {
      juryMap.set(vote.juryId, {
        juryId: vote.juryId,
        juryName: vote.juryName,
        votedGroupIds: [vote.groupId],
        lastUpdated: vote.updatedAt,
      });
    }
  }

  const summaries: GroupSummary[] = groupRows.map((g) => {
    const groupVotes = votesByGroup.get(g.id) ?? [];
    const voteCount = groupVotes.length;

    if (voteCount === 0) {
      return {
        id: g.id,
        name: g.name,
        topic: g.topic,
        voteCount: 0,
        criteriaAvg: { bilgi: 0, sunum: 0, emek: 0, malzeme: 0 },
        avgOutOf5: 0,
        avgOutOf20: 0,
        totalPoints: 0,
        rank: 0,
      };
    }

    let sumBilgi = 0;
    let sumSunum = 0;
    let sumEmek = 0;
    let sumMalzeme = 0;

    for (const v of groupVotes) {
      sumBilgi += v.bilgi;
      sumSunum += v.sunum;
      sumEmek += v.emek;
      sumMalzeme += v.malzeme;
    }

    const totalPoints = sumBilgi + sumSunum + sumEmek + sumMalzeme;
    const avgOutOf5 = round2(totalPoints / (voteCount * 4));
    const avgOutOf20 = round2(totalPoints / voteCount);

    return {
      id: g.id,
      name: g.name,
      topic: g.topic,
      voteCount,
      criteriaAvg: {
        bilgi: round2(sumBilgi / voteCount),
        sunum: round2(sumSunum / voteCount),
        emek: round2(sumEmek / voteCount),
        malzeme: round2(sumMalzeme / voteCount),
      },
      avgOutOf5,
      avgOutOf20,
      totalPoints,
      rank: 0,
    };
  });

  const leaderboard = [...summaries].sort((a, b) => {
    if (a.voteCount === 0 && b.voteCount > 0) return 1;
    if (b.voteCount === 0 && a.voteCount > 0) return -1;

    if (settings.sortMode === "total") {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
      if (b.avgOutOf5 !== a.avgOutOf5) return b.avgOutOf5 - a.avgOutOf5;
    } else {
      if (b.avgOutOf5 !== a.avgOutOf5) return b.avgOutOf5 - a.avgOutOf5;
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    }

    if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;
    return a.id - b.id;
  });

  let currentRank = 0;
  let lastScoreKey = "";
  let scoredSeen = 0;

  for (const item of leaderboard) {
    if (item.voteCount === 0) {
      item.rank = 0;
      continue;
    }
    scoredSeen += 1;
    const scoreKey =
      settings.sortMode === "total"
        ? `${item.totalPoints}:${item.avgOutOf5}`
        : `${item.avgOutOf5}:${item.totalPoints}`;
    if (scoreKey !== lastScoreKey) {
      currentRank = scoredSeen;
      lastScoreKey = scoreKey;
    }
    item.rank = currentRank;
  }

  const juries = Array.from(juryMap.values()).map((j) => ({
    ...j,
    votedGroupIds: [...j.votedGroupIds].sort((a, b) => a - b),
  }));

  const groupsWithVotes = summaries.filter((g) => g.voteCount > 0).length;

  return {
    criteria: CRITERIA,
    groups: summaries,
    leaderboard,
    votes,
    juries,
    settings,
    stats: {
      totalVotes: votes.length,
      uniqueJuries: juries.length,
      groupsWithVotes,
    },
    network: {
      port,
      urls: getLocalNetworkUrls(port),
    },
    serverTime: new Date().toISOString(),
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function parseJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export function createVotingServer(options: ServerOptions = {}) {
  const dbPath =
    options.dbPath ??
    process.env.DATABASE_PATH ??
    process.env.DB_PATH ??
    path.join(import.meta.dir, "data", "oylama.sqlite");
  const requestedPort =
    options.port ??
    (process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 3000);
  const hostname = options.hostname ?? process.env.HOST ?? "0.0.0.0";

  const db = initDatabase(dbPath);
  const htmlPath = path.join(import.meta.dir, "public", "index.html");
  let activePort = requestedPort;

  const startBunServer = (portToTry: number) =>
    Bun.serve({
      port: portToTry,
      hostname,
      async fetch(req, srv) {
        activePort = srv.port;
        const url = new URL(req.url);
        const { pathname } = url;

        if (pathname === "/ws") {
          const upgraded = srv.upgrade(req);
          if (upgraded) return undefined;
          return new Response("WebSocket bağlantısı başlatılamadı.", { status: 400 });
        }

        if (pathname === "/api/health" && req.method === "GET") {
          return jsonResponse({ ok: true });
        }

        if (pathname === "/api/state" && req.method === "GET") {
          return jsonResponse(buildAppState(db, srv.port));
        }

        if (pathname === "/api/vote" && req.method === "POST") {
          const body = await parseJsonBody(req);
          if (!body) {
            return jsonResponse({ error: "Geçersiz JSON gövdesi." }, 400);
          }

          const juryName = String(body.juryName ?? "").trim();
          if (juryName.length < 1 || juryName.length > 60) {
            return jsonResponse(
              { error: "Jüri adı 1 ile 60 karakter arasında olmalıdır." },
              400
            );
          }

          const rawJuryId = typeof body.juryId === "string" ? body.juryId.trim() : "";
          const juryId = rawJuryId || normalizeJuryId(juryName);

          const groupId = Number(body.groupId);
          if (!Number.isInteger(groupId) || groupId < 1 || groupId > 6) {
            return jsonResponse({ error: "Geçerli bir grup seçilmelidir (1-6)." }, 400);
          }

          const bilgi = Number(body.bilgi);
          const sunum = Number(body.sunum);
          const emek = Number(body.emek);
          const malzeme = Number(body.malzeme);

          if (
            !isValidScore(bilgi) ||
            !isValidScore(sunum) ||
            !isValidScore(emek) ||
            !isValidScore(malzeme)
          ) {
            return jsonResponse(
              { error: "Tüm kriterler 1 ile 5 arasında tam sayı olmalıdır." },
              400
            );
          }

          const existing = db
            .query("SELECT id FROM votes WHERE jury_id = ?1 AND group_id = ?2")
            .get(juryId, groupId) as { id: number } | null;

          const now = new Date().toISOString();
          db.prepare(
            `INSERT INTO votes (jury_id, jury_name, group_id, bilgi, sunum, emek, malzeme, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(jury_id, group_id) DO UPDATE SET
               jury_name = excluded.jury_name,
               bilgi = excluded.bilgi,
               sunum = excluded.sunum,
               emek = excluded.emek,
               malzeme = excluded.malzeme,
               updated_at = excluded.updated_at`
          ).run(juryId, juryName, groupId, bilgi, sunum, emek, malzeme, now);

          const groupRow = db
            .query("SELECT name FROM groups WHERE id = ?1")
            .get(groupId) as { name: string } | null;
          const totalScore = bilgi + sunum + emek + malzeme;

          const state = buildAppState(db, srv.port);
          const event: BroadcastEvent = {
            type: "VOTE_CAST",
            juryName,
            groupId,
            groupName: groupRow?.name ?? `${groupId}. Grup`,
            totalScore,
            avgScore: round2(totalScore / 4),
            updated: Boolean(existing),
          };
          srv.publish(
            "broadcast",
            JSON.stringify({ type: "STATE_UPDATE", state, event })
          );

          return jsonResponse({ ok: true, state, event });
        }

        if (pathname === "/api/groups" && req.method === "PUT") {
          const body = await parseJsonBody(req);
          if (!body || !Array.isArray(body.groups)) {
            return jsonResponse({ error: "groups dizisi gereklidir." }, 400);
          }

          const stmt = db.prepare(
            "UPDATE groups SET name = ?1, topic = ?2 WHERE id = ?3"
          );

          for (const item of body.groups) {
            if (!item || typeof item !== "object") continue;
            const entry = item as Record<string, unknown>;
            const id = Number(entry.id);
            if (!Number.isInteger(id) || id < 1 || id > 6) continue;
            const name = String(entry.name ?? "").trim().slice(0, 60) || `${id}. Grup`;
            const topic = String(entry.topic ?? "").trim().slice(0, 120);
            stmt.run(name, topic, id);
          }

          const state = buildAppState(db, srv.port);
          const event: BroadcastEvent = { type: "GROUPS_UPDATED" };
          srv.publish(
            "broadcast",
            JSON.stringify({ type: "STATE_UPDATE", state, event })
          );
          return jsonResponse({ ok: true, state });
        }

        if (pathname === "/api/settings" && req.method === "PUT") {
          const body = await parseJsonBody(req);
          if (!body) {
            return jsonResponse({ error: "Geçersiz JSON gövdesi." }, 400);
          }

          const upsert = db.prepare(
            `INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value`
          );

          if (body.activeGroupId !== undefined) {
            const activeGroupId = Number(body.activeGroupId);
            if (!Number.isInteger(activeGroupId) || activeGroupId < 0 || activeGroupId > 6) {
              return jsonResponse(
                { error: "activeGroupId 0 ile 6 arasında olmalıdır." },
                400
              );
            }
            upsert.run("active_group_id", String(activeGroupId));
          }

          if (body.sortMode !== undefined) {
            if (body.sortMode !== "average" && body.sortMode !== "total") {
              return jsonResponse(
                { error: "sortMode 'average' veya 'total' olmalıdır." },
                400
              );
            }
            upsert.run("sort_mode", body.sortMode);
          }

          if (body.tvMode !== undefined) {
            if (body.tvMode !== "leaderboard" && body.tvMode !== "spotlight") {
              return jsonResponse(
                { error: "tvMode 'leaderboard' veya 'spotlight' olmalıdır." },
                400
              );
            }
            upsert.run("tv_mode", body.tvMode);
          }

          const state = buildAppState(db, srv.port);
          const event: BroadcastEvent = {
            type: "SETTINGS_UPDATED",
            settings: state.settings,
          };
          srv.publish(
            "broadcast",
            JSON.stringify({ type: "STATE_UPDATE", state, event })
          );
          return jsonResponse({ ok: true, state });
        }

        if (pathname === "/api/vote" && req.method === "DELETE") {
          const body = await parseJsonBody(req);
          const juryIdParam =
            url.searchParams.get("juryId") ??
            (typeof body?.juryId === "string" ? body.juryId : "");
          const groupIdRaw =
            url.searchParams.get("groupId") ??
            (body?.groupId !== undefined ? String(body.groupId) : "");

          if (!juryIdParam) {
            return jsonResponse({ error: "Silme işlemi için juryId gereklidir." }, 400);
          }

          if (groupIdRaw) {
            const groupId = Number(groupIdRaw);
            if (!Number.isInteger(groupId) || groupId < 1 || groupId > 6) {
              return jsonResponse({ error: "Geçersiz groupId." }, 400);
            }
            db.prepare("DELETE FROM votes WHERE jury_id = ?1 AND group_id = ?2").run(
              juryIdParam,
              groupId
            );
          } else {
            db.prepare("DELETE FROM votes WHERE jury_id = ?1").run(juryIdParam);
          }

          const state = buildAppState(db, srv.port);
          const event: BroadcastEvent = { type: "VOTE_DELETED" };
          srv.publish(
            "broadcast",
            JSON.stringify({ type: "STATE_UPDATE", state, event })
          );
          return jsonResponse({ ok: true, state });
        }

        if (pathname === "/api/demo" && req.method === "POST") {
          const demoJuries = [
            {
              juryName: "Prof. Dr. Ayşe Demir",
              scores: [
                [1, 5, 5, 4, 5],
                [2, 4, 5, 4, 4],
                [3, 5, 4, 5, 4],
                [4, 4, 4, 5, 5],
                [5, 3, 4, 4, 4],
                [6, 5, 5, 5, 4],
              ],
            },
            {
              juryName: "Mehmet Kaya",
              scores: [
                [1, 4, 5, 5, 4],
                [2, 4, 4, 4, 5],
                [3, 5, 5, 4, 4],
                [4, 3, 4, 4, 4],
                [5, 4, 4, 3, 4],
                [6, 5, 4, 5, 5],
              ],
            },
            {
              juryName: "Zeynep Arslan",
              scores: [
                [1, 5, 4, 5, 5],
                [2, 5, 4, 4, 4],
                [3, 4, 4, 5, 5],
                [4, 4, 5, 4, 4],
                [5, 4, 3, 4, 3],
                [6, 5, 5, 5, 5],
              ],
            },
          ];

          const now = new Date().toISOString();
          const insertVote = db.prepare(
            `INSERT INTO votes (jury_id, jury_name, group_id, bilgi, sunum, emek, malzeme, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(jury_id, group_id) DO UPDATE SET
               jury_name = excluded.jury_name,
               bilgi = excluded.bilgi,
               sunum = excluded.sunum,
               emek = excluded.emek,
               malzeme = excluded.malzeme,
               updated_at = excluded.updated_at`
          );

          for (const jury of demoJuries) {
            const jId = normalizeJuryId(jury.juryName);
            for (const [groupId, bilgi, sunum, emek, malzeme] of jury.scores) {
              insertVote.run(
                jId,
                jury.juryName,
                groupId,
                bilgi,
                sunum,
                emek,
                malzeme,
                now
              );
            }
          }

          const state = buildAppState(db, srv.port);
          const event: BroadcastEvent = { type: "DEMO_LOADED" };
          srv.publish(
            "broadcast",
            JSON.stringify({ type: "STATE_UPDATE", state, event })
          );
          return jsonResponse({ ok: true, state });
        }

        if (pathname === "/api/reset" && req.method === "POST") {
          db.exec("DELETE FROM votes;");
          db.prepare(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('active_group_id', '0')"
          ).run();

          const state = buildAppState(db, srv.port);
          const event: BroadcastEvent = { type: "RESET" };
          srv.publish(
            "broadcast",
            JSON.stringify({ type: "STATE_UPDATE", state, event })
          );
          return jsonResponse({ ok: true, state });
        }

        if (
          req.method === "GET" &&
          (pathname === "/" ||
            pathname === "/juri" ||
            pathname === "/tv" ||
            pathname === "/yonetim")
        ) {
          const file = Bun.file(htmlPath);
          if (await file.exists()) {
            return new Response(file, {
              headers: {
                "content-type": "text/html; charset=utf-8",
                "cache-control": "no-store",
              },
            });
          }
          return new Response("Arayüz dosyası bulunamadı.", { status: 404 });
        }

        return jsonResponse({ error: "Bulunamadı." }, 404);
      },
      websocket: {
        open(ws) {
          ws.subscribe("broadcast");
          ws.send(
            JSON.stringify({
              type: "STATE_UPDATE",
              state: buildAppState(db, activePort),
            })
          );
        },
        message(ws, message) {
          if (message === "ping") {
            ws.send("pong");
          }
        },
        close(ws) {
          ws.unsubscribe("broadcast");
        },
      },
    });

  let server: ReturnType<typeof startBunServer>;
  try {
    server = startBunServer(requestedPort);
  } catch (err) {
    if (options.port === undefined && !process.env.PORT && requestedPort !== 0) {
      server = startBunServer(0);
    } else {
      throw err;
    }
  }
  activePort = server.port ?? requestedPort;

  return {
    server,
    db,
    port: server.port,
    getState: () => buildAppState(db, server.port),
    close: () => {
      server.stop(true);
      db.close();
    },
  };
}

if (import.meta.main) {
  const app = createVotingServer();
  const state = app.getState();
  console.log(`\nCanlı Sunum Oylama Sunucusu çalışıyor!`);
  console.log(`  Yerel erişim : http://localhost:${app.port}`);
  for (const url of state.network.urls) {
    console.log(`  Ağ erişimi   : ${url}`);
  }
  console.log(`  TV Ekranı    : http://localhost:${app.port}/tv`);
  console.log(`  Jüri Ekranı  : http://localhost:${app.port}/juri`);
  console.log(`  Yönetim      : http://localhost:${app.port}/yonetim\n`);
}
