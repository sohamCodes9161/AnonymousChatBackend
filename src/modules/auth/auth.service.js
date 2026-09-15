import crypto from 'crypto';
import { User } from '../users/user.model.js';
import { RefreshToken } from './refreshToken.model.js';
import { hashPassword, verifyPassword } from '../../utils/password.js';
import { signAccessToken } from '../../utils/jwt.js';
import { generateRawToken, hashToken, parseDuration } from '../../utils/token.js';
import { config } from '../../config/index.js';
import { AppError, ErrorCodes } from '../../utils/AppError.js';

// Identical error regardless of which part failed — never reveal
// whether a username exists (account enumeration, Security module).
function invalidCredentialsError() {
  return new AppError(
    ErrorCodes.AUTH_INVALID_CREDENTIALS,
    'Invalid username or password',
    401
  );
}

async function issueTokenPair(user, deviceId) {
  const accessToken = signAccessToken(user._id);
  const rawRefreshToken = generateRawToken();

  await RefreshToken.create({
    userId: user._id,
    tokenHash: hashToken(rawRefreshToken),
    deviceId: deviceId || crypto.randomUUID(),
    expiresAt: new Date(Date.now() + parseDuration(config.jwt.refreshExpiry)),
  });

  return { accessToken, rawRefreshToken, user };
}

export async function register({ username, password, displayName }) {
  const usernameLower = username.toLowerCase();

  const existing = await User.findOne({ usernameLower });
  if (existing) {
    throw new AppError(ErrorCodes.AUTH_USERNAME_TAKEN, 'Username already taken', 409);
  }

  const passwordHash = await hashPassword(password);
  const user = await User.create({
    username,
    usernameLower,
    passwordHash,
    displayName: displayName || username,
  });

  // Registration ends in an active session — no separate login step
  // required, per the User/Profile module design.
  return issueTokenPair(user, undefined);
}

export async function login({ username, password, deviceId }) {
  const usernameLower = username.toLowerCase();
  const user = await User.findOne({ usernameLower });

  if (!user) throw invalidCredentialsError();

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError(
      ErrorCodes.AUTH_ACCOUNT_LOCKED,
      'Too many failed attempts. Try again later.',
      423
    );
  }

  const validPassword = await verifyPassword(user.passwordHash, password);

  if (!validPassword) {
    user.failedLoginAttempts += 1;
    if (user.failedLoginAttempts >= config.loginRateLimit.maxAttempts) {
      user.lockedUntil = new Date(
        Date.now() + parseDuration(config.loginRateLimit.lockoutDuration)
      );
      user.failedLoginAttempts = 0;
    }
    await user.save();
    throw invalidCredentialsError();
  }

  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  await user.save();

  return issueTokenPair(user, deviceId);
}

export async function refresh(rawRefreshToken) {
  if (!rawRefreshToken) {
    throw new AppError(ErrorCodes.AUTH_TOKEN_INVALID, 'No refresh token provided', 401);
  }

  const tokenHash = hashToken(rawRefreshToken);
  const tokenDoc = await RefreshToken.findOne({ tokenHash });

  if (!tokenDoc) {
    throw new AppError(ErrorCodes.AUTH_TOKEN_INVALID, 'Invalid refresh token', 401);
  }

  if (tokenDoc.revokedAt) {
    // Reuse of an already-rotated token — a strong signal of theft.
    // Revoke every other active session for this user as a precaution.
    await RefreshToken.updateMany(
      { userId: tokenDoc.userId, revokedAt: null },
      { revokedAt: new Date() }
    );
    throw new AppError(
      ErrorCodes.AUTH_TOKEN_INVALID,
      'Refresh token already used — all sessions revoked for safety',
      401
    );
  }

  if (tokenDoc.expiresAt < new Date()) {
    throw new AppError(ErrorCodes.AUTH_TOKEN_INVALID, 'Refresh token expired', 401);
  }

  const user = await User.findById(tokenDoc.userId);
  if (!user) {
    throw new AppError(ErrorCodes.AUTH_TOKEN_INVALID, 'User no longer exists', 401);
  }

  // Rotate: revoke the presented token, issue a fresh pair tied to the
  // same device.
  tokenDoc.revokedAt = new Date();
  await tokenDoc.save();

  return issueTokenPair(user, tokenDoc.deviceId);
}

export async function logout(rawRefreshToken) {
  if (!rawRefreshToken) return;
  const tokenHash = hashToken(rawRefreshToken);
  await RefreshToken.updateOne({ tokenHash }, { revokedAt: new Date() });
}
