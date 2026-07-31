import type { Request, Response } from "express";
import { z } from "zod";
import { ForbiddenError } from "../../common/errors.js";
import * as pushService from "./push.service.js";

function getDriverId(req: Request): number {
  const driverId = req.authUser?.driver?.id;
  if (!driverId) {
    throw new ForbiddenError("No driver profile linked to this account");
  }
  return driverId;
}

export async function getVapidPublicKey(_req: Request, res: Response) {
  res.json({ publicKey: pushService.getVapidPublicKey() });
}

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1)
  })
});

export async function subscribe(req: Request, res: Response) {
  const driverId = getDriverId(req);
  const input = subscribeSchema.parse(req.body);
  await pushService.saveSubscription({
    driverId,
    endpoint: input.endpoint,
    keys: input.keys,
    userAgent: req.headers["user-agent"]
  });
  res.status(201).json({ ok: true });
}

const unsubscribeSchema = z.object({
  endpoint: z.string().url()
});

export async function unsubscribe(req: Request, res: Response) {
  const driverId = getDriverId(req);
  const input = unsubscribeSchema.parse(req.body);
  await pushService.removeSubscription(driverId, input.endpoint);
  res.status(204).send();
}
