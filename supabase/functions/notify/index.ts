/* 数据库有新东西时自动推送。
   由数据库触发器调用（migration-4 / migration-5 建的，
   不是控制台的 Database Webhook —— 那个依赖的 schema 这项目没有）：

     items 插入    → 「XX 加了新视频」        推给房间里其他人
     comments 插入 → 「XX 在《某视频》下说」   推给房间里其他人
     watches 插入  → 「XX 看完了你分享的」    只推给分享者

   用 jsr:@negrel/webpush 而不是 npm:web-push —— 前者只依赖 Web Crypto，
   在 Deno 里不需要 Node 兼容层，少一层出问题的可能。 */
import * as webpush from "jsr:@negrel/webpush@0.5.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_JWK = Deno.env.get("VAPID_JWK")!;
const CONTACT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:you@example.com";
const SITE = Deno.env.get("SITE_URL") ?? "https://your-site.example.com";

const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

async function db(pathAndQuery: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, { headers: H });
  if (!r.ok) throw new Error(`查询失败 ${pathAndQuery}: ${r.status} ${await r.text()}`);
  return r.json();
}

let appServer: webpush.ApplicationServer | null = null;
async function server() {
  if (appServer) return appServer;
  const keys = await webpush.importVapidKeys(JSON.parse(VAPID_JWK), { extractable: false });
  appServer = await webpush.ApplicationServer.new({ contactInformation: CONTACT, vapidKeys: keys });
  return appServer;
}

function trim(s: string, n: number) {
  s = (s ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
}

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const table = body.table as string;
    const rec = body.record;
    if (body.type !== "INSERT" || !rec) return new Response("ignored", { status: 200 });

    let actorId: string | null = null;
    let title = "";
    let text = "";
    let tag = "";
    let link = SITE;
    let onlyMember: string | null = null;   // 只推给这一个成员（watches 用）
    const roomId: string = rec.room_id;

    if (table === "items") {
      actorId = rec.added_by;
      const [room] = await db(`rooms?id=eq.${roomId}&select=code,name`);
      const actor = actorId ? (await db(`members?id=eq.${actorId}&select=name`))[0] : null;
      title = `${actor?.name ?? "有人"}加了新视频`;
      text = trim(rec.title, 60);
      // 同一个房间的新条目互相折叠，不刷屏
      tag = `wl-room-${room?.code ?? roomId}`;
      link = `${SITE}/?r=${room?.code ?? ""}`;

    } else if (table === "comments") {
      actorId = rec.member_id;
      const [item] = await db(`items?id=eq.${rec.item_id}&select=title,room_id`);
      const [room] = await db(`rooms?id=eq.${roomId}&select=code,name`);
      const actor = actorId ? (await db(`members?id=eq.${actorId}&select=name`))[0] : null;
      title = `${actor?.name ?? "有人"}在《${trim(item?.title ?? "", 20)}》下说`;
      text = trim(rec.text, 80);
      // 按条目折叠：一条视频下来回聊，通知中心里始终只占一条
      tag = `wl-item-${rec.item_id}`;
      link = `${SITE}/?r=${room?.code ?? ""}`;

    } else if (table === "watches") {
      /* 谁看完了别人分享的东西，就告诉分享的那个人。
         「我推给你的那个你看了没」是分享者真正关心的事；
         「某某打了个勾」本身没用，所以只推给 added_by 一个人。 */
      actorId = rec.member_id;
      const [item] = await db(
        `items?id=eq.${rec.item_id}&select=title,added_by`,
      );
      // 自己看自己分享的，不用通知自己
      if (!item?.added_by || item.added_by === actorId) {
        return new Response("no sharer to notify", { status: 200 });
      }
      const actor = actorId
        ? (await db(`members?id=eq.${actorId}&select=name`))[0]
        : null;
      const [room] = await db(`rooms?id=eq.${roomId}&select=code`);

      title = `${actor?.name ?? "有人"}看完了你分享的`;
      text = trim(item.title ?? "", 60);
      // 按条目折叠：三人房间里陆续有人看完，通知中心里只占一条
      tag = `wl-seen-${rec.item_id}`;
      link = `${SITE}/?r=${room?.code ?? ""}`;
      // 只推给分享者本人
      onlyMember = item.added_by;

    } else {
      return new Response("unsupported table", { status: 200 });
    }

    // 默认推给房间里除动作发起人以外的所有人；
    // onlyMember 有值时只推给那一个（比如「你分享的东西对方看完了」）
    const members = await db(`members?room_id=eq.${roomId}&select=id,user_key`);
    const audience = onlyMember
      ? members.filter((m: any) => m.id === onlyMember)
      : members.filter((m: any) => m.id !== actorId);
    const keys = [...new Set(
      audience.filter((m: any) => m.user_key).map((m: any) => m.user_key)
    )];
    if (!keys.length) return new Response("no one to notify", { status: 200 });

    const inList = `(${keys.map((k) => `"${k}"`).join(",")})`;
    const subs = await db(`push_subs?user_key=in.${inList}&select=*`);
    if (!subs.length) return new Response("no subscriptions", { status: 200 });

    const app = await server();
    const payload = JSON.stringify({ title, body: text, url: link, tag });

    let sent = 0, gone = 0;
    await Promise.all(subs.map(async (row: any) => {
      try {
        await app.subscribe(row.sub).pushTextMessage(payload, {
          urgency: webpush.Urgency.High,
          ttl: 86400,   // 一天没送到就算了，隔天再弹没意义
        });
        sent++;
      } catch (e) {
        const code = (e as any)?.response?.status;
        // 404/410 = 订阅失效（卸载了 / 关了通知），清掉免得越堆越多
        if (code === 404 || code === 410) {
          gone++;
          await fetch(
            `${SUPABASE_URL}/rest/v1/push_subs?endpoint=eq.${encodeURIComponent(row.endpoint)}`,
            { method: "DELETE", headers: H },
          );
        } else {
          console.error("推送失败", code, String(e).slice(0, 200));
        }
      }
    }));

    console.log(`[${table}] ${title} → 成功 ${sent}，清理失效 ${gone}`);
    return new Response(JSON.stringify({ sent, gone }), {
      headers: { "content-type": "application/json" },
    });

  } catch (e) {
    console.error("出错:", e);
    // 返回 200：webhook 失败不该反过来影响用户的写入操作
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
});
