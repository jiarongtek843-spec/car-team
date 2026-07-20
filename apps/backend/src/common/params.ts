import { ValidationError } from "./errors.js";

export function parseIdParam(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ValidationError(`Invalid id: ${value}`);
  }
  return id;
}
