import argon2 from 'argon2';
import { config } from '../config/index.js';

export async function hashPassword(password) {
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: config.argon2.memoryCost,
    timeCost: config.argon2.timeCost,
  });
}

export async function verifyPassword(hash, password) {
  return argon2.verify(hash, password);
}
