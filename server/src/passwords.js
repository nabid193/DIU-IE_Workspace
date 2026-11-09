import { promisify } from "node:util";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

const scrypt = promisify(scryptCallback);
const COST = 32_768;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 64 * 1024 * 1024;

export function passwordPolicyError(password) {
  if (typeof password !== "string") return "Enter a password.";
  if (password.length < 8) return "Use at least 8 characters.";
  if (password.length > 128) return "Use no more than 128 characters.";
  if (!/[A-Z]/.test(password)) return "Include at least one uppercase letter.";
  if (!/[a-z]/.test(password)) return "Include at least one lowercase letter.";
  if (!/[0-9]/.test(password)) return "Include at least one number.";
  if (!/[^A-Za-z0-9\s]/.test(password)) return "Include at least one special character, such as !, @, or #.";
  return null;
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELISM,
    maxmem: MAX_MEMORY,
  });

  return ["scrypt", COST, BLOCK_SIZE, PARALLELISM, salt.toString("hex"), derivedKey.toString("hex")].join("$");
}

export async function verifyPassword(password, storedHash) {
  const [algorithm, cost, blockSize, parallelism, saltHex, keyHex, extra] = storedHash.split("$");
  if (algorithm !== "scrypt" || !saltHex || !keyHex || extra !== undefined) return false;
  if (Number(cost) !== COST || Number(blockSize) !== BLOCK_SIZE || Number(parallelism) !== PARALLELISM) return false;

  const salt = Buffer.from(saltHex, "hex");
  const expectedKey = Buffer.from(keyHex, "hex");
  if (salt.length !== 16 || expectedKey.length !== KEY_LENGTH) return false;

  const actualKey = await scrypt(password, salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELISM,
    maxmem: MAX_MEMORY,
  });

  return timingSafeEqual(expectedKey, actualKey);
}
