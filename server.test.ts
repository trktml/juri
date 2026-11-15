import { afterEach, describe, expect, test } from "bun:test";
import { createVotingServer } from "./server";

let activeApp: ReturnType<typeof createVotingServer> | null = null;

afterEach(() => {
  if (activeApp) {
    activeApp.close();
    activeApp = null;
  }
});

function startTestServer() {
  activeApp = createVotingServer({
    dbPath: ":memory:",
    port: 0,
    hostname: "127.0.0.1",
  });
  return {
    app: activeApp,
    baseUrl: `http://127.0.0.1:${activeApp.port}`,
    wsUrl: `ws://127.0.0.1:${activeApp.port}/ws`,
  };
}

describe("Canlı Sunum Oylama Sunucusu", () => {
  test("6 grubu ve 4 kriteri varsayılan olarak başlatır", async () => {
    const { baseUrl } = startTestServer();
    const res = await fetch(`${baseUrl}/api/state`);
    expect(res.status).toBe(200);

    const state = await res.json();
    expect(state.groups).toHaveLength(6);
    expect(state.groups.map((g: { id: number; name: string }) => [g.id, g.name])).toEqual([
      [1, "1. Grup"],
      [2, "2. Grup"],
      [3, "3. Grup"],
      [4, "4. Grup"],
      [5, "5. Grup"],
      [6, "6. Grup"],
    ]);

    expect(state.criteria.map((c: { label: string }) => c.label)).toEqual([
      "Bilgilerin yeterliliği",
      "Sunum becerisi",
      "Hazırlanma emeği",
      "Malzeme kalitesi",
    ]);
  });

  test("1-5 dışındaki puanları, geçersiz grup numaralarını ve boş jüri adını reddeder", async () => {
    const { baseUrl } = startTestServer();

    const badLow = await fetch(`${baseUrl}/api/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        juryName: "Jüri 1",
        groupId: 1,
        bilgi: 0,
        sunum: 4,
        emek: 4,
        malzeme: 4,
      }),
    });
    expect(badLow.status).toBe(400);

    const badHigh = await fetch(`${baseUrl}/api/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        juryName: "Jüri 1",
        groupId: 1,
        bilgi: 5,
        sunum: 6,
        emek: 4,
        malzeme: 4,
      }),
    });
    expect(badHigh.status).toBe(400);

    const badDecimal = await fetch(`${baseUrl}/api/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        juryName: "Jüri 1",
        groupId: 1,
        bilgi: 4.5,
        sunum: 4,
        emek: 4,
        malzeme: 4,
      }),
    });
    expect(badDecimal.status).toBe(400);

    const badGroup = await fetch(`${baseUrl}/api/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        juryName: "Jüri 1",
        groupId: 7,
        bilgi: 5,
        sunum: 5,
        emek: 5,
        malzeme: 5,
      }),
    });
    expect(badGroup.status).toBe(400);

    const badName = await fetch(`${baseUrl}/api/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        juryName: "   ",
        groupId: 1,
        bilgi: 5,
        sunum: 5,
        emek: 5,
        malzeme: 5,
      }),
    });
    expect(badName.status).toBe(400);
  });

  test("birden fazla jürinin oyunu ve aynı jürinin oy güncellemesini doğru hesaplar", async () => {
    const { baseUrl } = startTestServer();

    // Jüri A - Grup 2'ye oy verir: 5, 4, 3, 4 => toplam 16, ort 4.00
    const r1 = await fetch(`${baseUrl}/api/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        juryName: "Dr. Ali Kaya",
        groupId: 2,
        bilgi: 5,
        sunum: 4,
        emek: 3,
        malzeme: 4,
      }),
    });
    expect(r1.status).toBe(200);

    // Jüri B - Grup 2'ye oy verir: 3, 4, 5, 4 => toplam 16, ort 4.00
    const r2 = await fetch(`${baseUrl}/api/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        juryName: "Zeynep Demir",
        groupId: 2,
        bilgi: 3,
        sunum: 4,
        emek: 5,
        malzeme: 4,
      }),
    });
    expect(r2.status).toBe(200);

    // Jüri A (büyük/küçük harf farklı olsa bile) Grup 2 oyunu günceller: 5, 5, 5, 5 => toplam 20
    const r3 = await fetch(`${baseUrl}/api/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        juryName: "dr. ali kaya",
        groupId: 2,
        bilgi: 5,
        sunum: 5,
        emek: 5,
        malzeme: 5,
      }),
    });
    expect(r3.status).toBe(200);
    const body3 = await r3.json();
    expect(body3.event.updated).toBe(true);

    // Grup 1'e 1 jüri düşük oy versin: 3, 3, 3, 3 => toplam 12, ort 3.00
    await fetch(`${baseUrl}/api/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        juryName: "Dr. Ali Kaya",
        groupId: 1,
        bilgi: 3,
        sunum: 3,
        emek: 3,
        malzeme: 3,
      }),
    });

    const stateRes = await fetch(`${baseUrl}/api/state`);
    const state = await stateRes.json();

    const g2 = state.groups.find((g: { id: number }) => g.id === 2);
    expect(g2.voteCount).toBe(2); // güncelleme tekil kaldı
    expect(g2.totalPoints).toBe(36); // 20 + 16
    expect(g2.avgOutOf20).toBe(18);
    expect(g2.avgOutOf5).toBe(4.5);
    expect(g2.criteriaAvg).toEqual({
      bilgi: 4, // (5+3)/2
      sunum: 4.5, // (5+4)/2
      emek: 5, // (5+5)/2
      malzeme: 4.5, // (5+4)/2
    });

    expect(state.leaderboard[0].id).toBe(2);
    expect(state.leaderboard[0].rank).toBe(1);
    expect(state.leaderboard[1].id).toBe(1);
    expect(state.leaderboard[1].rank).toBe(2);
    expect(state.stats.totalVotes).toBe(3);
    expect(state.stats.uniqueJuries).toBe(2);
  });

  test("WebSocket üzerinden anlık STATE_UPDATE ve VOTE_CAST bildirimi yayınlar", async () => {
    const { baseUrl, wsUrl } = startTestServer();

    const messages: Array<{ type: string; event?: { type: string; juryName: string; totalScore: number } }> = [];

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error("WebSocket zaman aşımı"));
      }, 3000);

      socket.addEventListener("message", async (evt) => {
        const data = JSON.parse(String(evt.data));
        messages.push(data);

        if (messages.length === 1) {
          // İlk bağlantı mesajı alındıktan sonra REST üzerinden oy gönder
          await fetch(`${baseUrl}/api/vote`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              juryName: "Canlı Jüri",
              groupId: 4,
              bilgi: 5,
              sunum: 4,
              emek: 5,
              malzeme: 5,
            }),
          });
        } else if (messages.length >= 2) {
          clearTimeout(timer);
          socket.close();
          resolve();
        }
      });

      socket.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("WebSocket hatası"));
      });
    });

    expect(messages[0].type).toBe("STATE_UPDATE");
    expect(messages[1].type).toBe("STATE_UPDATE");
    expect(messages[1].event?.type).toBe("VOTE_CAST");
    expect(messages[1].event?.juryName).toBe("Canlı Jüri");
    expect(messages[1].event?.totalScore).toBe(19);
  });

  test("grup düzenleme, ayar güncelleme, demo ve sıfırlama rotalarını çalıştırır", async () => {
    const { baseUrl } = startTestServer();

    const putGroups = await fetch(`${baseUrl}/api/groups`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        groups: [
          { id: 1, name: "Yıldızlar", topic: "Güneş Enerjisi" },
          { id: 2, name: "Ufuk Ekibi", topic: "Akıllı Tarım" },
        ],
      }),
    });
    expect(putGroups.status).toBe(200);

    const putSettings = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        activeGroupId: 2,
        sortMode: "total",
        tvMode: "spotlight",
      }),
    });
    expect(putSettings.status).toBe(200);

    const demoRes = await fetch(`${baseUrl}/api/demo`, { method: "POST" });
    expect(demoRes.status).toBe(200);
    const demoData = await demoRes.json();
    expect(demoData.state.stats.totalVotes).toBe(18);
    expect(demoData.state.groups[0].name).toBe("Yıldızlar");
    expect(demoData.state.settings.activeGroupId).toBe(2);
    expect(demoData.state.settings.sortMode).toBe("total");
    expect(demoData.state.settings.tvMode).toBe("spotlight");

    const resetRes = await fetch(`${baseUrl}/api/reset`, { method: "POST" });
    expect(resetRes.status).toBe(200);
    const resetData = await resetRes.json();
    expect(resetData.state.stats.totalVotes).toBe(0);
    expect(resetData.state.groups[0].name).toBe("Yıldızlar");
  });

  test("tekil oy silme, jüri silme ve eşit puanlarda aynı sırayı paylaşmayı destekler", async () => {
    const { baseUrl } = startTestServer();

    await fetch(`${baseUrl}/api/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        juryName: "Jüri 1",
        groupId: 1,
        bilgi: 4,
        sunum: 4,
        emek: 4,
        malzeme: 4,
      }),
    });

    await fetch(`${baseUrl}/api/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        juryName: "Jüri 2",
        groupId: 2,
        bilgi: 4,
        sunum: 4,
        emek: 4,
        malzeme: 4,
      }),
    });

    await fetch(`${baseUrl}/api/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        juryName: "Jüri 1",
        groupId: 3,
        bilgi: 3,
        sunum: 3,
        emek: 3,
        malzeme: 3,
      }),
    });

    let state = await (await fetch(`${baseUrl}/api/state`)).json();
    expect(state.leaderboard[0].rank).toBe(1);
    expect(state.leaderboard[1].rank).toBe(1);
    expect(state.leaderboard[2].rank).toBe(3);

    const delSingle = await fetch(`${baseUrl}/api/vote?juryId=j%C3%BCri%201&groupId=3`, {
      method: "DELETE",
    });
    expect(delSingle.status).toBe(200);
    state = (await delSingle.json()).state;
    expect(state.stats.totalVotes).toBe(2);

    const delJury = await fetch(`${baseUrl}/api/vote?juryId=j%C3%BCri%201`, {
      method: "DELETE",
    });
    expect(delJury.status).toBe(200);
    state = (await delJury.json()).state;
    expect(state.stats.totalVotes).toBe(1);
    expect(state.stats.uniqueJuries).toBe(1);
  });

  test("tüm arayüz rotalarından HTML sunar", async () => {
    const { baseUrl } = startTestServer();
    for (const route of ["/", "/juri", "/tv", "/yonetim"]) {
      const res = await fetch(`${baseUrl}${route}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      const text = await res.text();
      expect(text).toContain("Canlı Sunum Oylaması");
    }
  });
});
