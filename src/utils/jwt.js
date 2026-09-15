import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

export function signAccessToken(userId) {
  return jwt.sign({ sub: userId.toString() }, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpiry,
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, config.jwt.accessSecret);
}
