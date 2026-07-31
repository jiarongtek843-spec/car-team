import webpush from "web-push";
import { prisma } from "../../config/prisma.js";
import { ValidationError } from "../../common/errors.js";

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:admin@example.com";

// 没设定 VAPID Key 时整个模块退化成 no-op——本地开发/还没在 Railway 设定环境变量之前，
// 推播功能就是「安静地不推」，不该让 Notification Center 既有的核心流程（建立 Notification
// row）因为这个附加功能没设定就整个炸掉。
const isConfigured = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (isConfigured) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY!, VAPID_PRIVATE_KEY!);
}

export function getVapidPublicKey(): string | null {
  return VAPID_PUBLIC_KEY ?? null;
}

export interface SaveSubscriptionInput {
  driverId: number;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
}

/** endpoint 是浏览器帮这次订阅产生的唯一网址，同一个 Driver 换装置/重新订阅都会是新的
 * endpoint，用它当 upsert key 天生就不会重复——同一台装置重复呼叫也只会更新同一笔。 */
export async function saveSubscription(input: SaveSubscriptionInput) {
  if (!input.endpoint || !input.keys?.p256dh || !input.keys?.auth) {
    throw new ValidationError("endpoint/keys.p256dh/keys.auth are required");
  }

  return prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: {
      driverId: input.driverId,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: input.userAgent
    },
    update: {
      driverId: input.driverId,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: input.userAgent
    }
  });
}

/** Driver 自己点「关闭通知」，或换装置时浏览器自己让旧订阅失效，前端都会带 endpoint 来删。
 * 限定 driverId 一起匹配——不能让一个 Driver 靠猜/带别人的 endpoint 就删掉别人的订阅。
 * 找不到就当作已经删过了，不报错——不是 Driver 需要在意的事。 */
export async function removeSubscription(driverId: number, endpoint: string) {
  await prisma.pushSubscription.deleteMany({ where: { driverId, endpoint } });
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

/** 呼叫端（notification.service.ts 的 handleActivity）永远不该因为推播失败而炸掉——
 * Notification row 已经写进 DB 了，Driver 打开 App 一样看得到，推播只是「锦上添花」的
 * 即时提醒，失败就静默略过。订阅本身失效（浏览器回报 404/410）时顺手清掉，避免那笔
 * 死掉的订阅每次都白跑一次网路请求、拖慢推播速度。 */
export async function sendPushToDriver(driverId: number, payload: PushPayload) {
  if (!isConfigured) {
    return;
  }

  const subscriptions = await prisma.pushSubscription.findMany({ where: { driverId } });
  if (subscriptions.length === 0) {
    return;
  }

  const body = JSON.stringify(payload);

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body
        );
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await prisma.pushSubscription.deleteMany({ where: { endpoint: sub.endpoint } });
        }
        // 其他错误（暂时性网路问题等）不用特别处理，下一次推播事件自然会再试一次。
      }
    })
  );
}
