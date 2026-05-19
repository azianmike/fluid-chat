import { randomBytes, createHash } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

export async function hashPassword(password: string) {
  return hash(password, {
    memoryCost: 19456,
    timeCost: 2,
    outputLen: 32,
    parallelism: 1
  });
}

export async function verifyPassword(hashValue: string, password: string) {
  return verify(hashValue, password);
}

export function newToken(byteLength = 32) {
  return randomBytes(byteLength).toString("base64url");
}

export function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function addDays(days: number) {
  const value = new Date();
  value.setDate(value.getDate() + days);
  return value;
}

export function addHours(hours: number) {
  const value = new Date();
  value.setHours(value.getHours() + hours);
  return value;
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function slugify(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function normalizeChannelName(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
