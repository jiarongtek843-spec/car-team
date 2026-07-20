import type { Request, Response } from "express";
import { z } from "zod";
import * as driversService from "./drivers.service.js";

const driverStatusSchema = z.enum(["ACTIVE", "INACTIVE"]);

const createDriverSchema = z.object({
  name: z.string().min(1),
  phone: z.string().min(1).optional()
});

export async function list(req: Request, res: Response) {
  const status = req.query.status ? driverStatusSchema.parse(req.query.status) : undefined;
  const drivers = await driversService.listDrivers(status);
  res.json(drivers);
}

export async function create(req: Request, res: Response) {
  const input = createDriverSchema.parse(req.body);
  const driver = await driversService.createDriver(input);
  res.status(201).json(driver);
}
