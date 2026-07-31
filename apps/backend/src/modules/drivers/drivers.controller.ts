import type { Request, Response } from "express";
import { z } from "zod";
import * as driversService from "./drivers.service.js";
import { actorFromRequest, writeAuditLog } from "../../common/audit.js";
import { parseIdParam } from "../../common/params.js";

const driverStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);

const createDriverSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1).optional(),
  vehiclePlateNumber: z.string().min(1).optional(),
  remark: z.string().optional(),
  username: z.string().min(3).optional(),
  password: z.string().min(6).optional()
});

const updateDriverSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  vehiclePlateNumber: z.string().min(1).optional(),
  remark: z.string().optional()
});

const setStatusSchema = z.object({
  status: driverStatusSchema
});

const resetPasswordSchema = z.object({
  password: z.string().min(6)
});

const deleteDriverSchema = z.object({
  password: z.string().min(1)
});

export async function list(req: Request, res: Response) {
  const status = req.query.status ? driverStatusSchema.parse(req.query.status) : undefined;
  const drivers = await driversService.listDrivers(status);
  res.json(drivers);
}

export async function create(req: Request, res: Response) {
  const input = createDriverSchema.parse(req.body);
  const driver = await driversService.createDriver(input);

  await writeAuditLog({
    actor: actorFromRequest(req),
    action: "DRIVER_CREATE",
    entityType: "Driver",
    entityId: driver.id
  });

  res.status(201).json(driver);
}

export async function update(req: Request, res: Response) {
  const id = parseIdParam(req.params.id);
  const input = updateDriverSchema.parse(req.body);
  const driver = await driversService.updateDriver(id, input);

  await writeAuditLog({
    actor: actorFromRequest(req),
    action: "DRIVER_UPDATE",
    entityType: "Driver",
    entityId: driver.id
  });

  res.json(driver);
}

export async function setStatus(req: Request, res: Response) {
  const id = parseIdParam(req.params.id);
  const { status } = setStatusSchema.parse(req.body);
  const driver = await driversService.setDriverStatus(id, status);

  await writeAuditLog({
    actor: actorFromRequest(req),
    action: "DRIVER_STATUS_CHANGE",
    entityType: "Driver",
    entityId: driver.id,
    metadata: { status }
  });

  res.json(driver);
}

export async function resetPassword(req: Request, res: Response) {
  const id = parseIdParam(req.params.id);
  const { password } = resetPasswordSchema.parse(req.body);
  const driver = await driversService.resetDriverPassword(id, password);

  await writeAuditLog({
    actor: actorFromRequest(req),
    action: "DRIVER_PASSWORD_RESET",
    entityType: "Driver",
    entityId: driver.id
  });

  res.status(204).end();
}

export async function remove(req: Request, res: Response) {
  const id = parseIdParam(req.params.id);
  const { password } = deleteDriverSchema.parse(req.body);
  const actorId = req.authUser!.id;
  const deleted = await driversService.deleteDriver(id, actorId, password);

  await writeAuditLog({
    actor: actorFromRequest(req),
    action: "DRIVER_DELETE",
    entityType: "Driver",
    entityId: id,
    beforeData: {
      name: deleted.name,
      phone: deleted.phone,
      vehiclePlateNumber: deleted.vehiclePlateNumber,
      status: deleted.status
    }
  });

  res.status(204).end();
}
