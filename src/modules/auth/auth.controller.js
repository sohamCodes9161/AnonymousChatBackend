import * as authService from './auth.service.js';
import { config } from '../../config/index.js';
import { parseDuration } from '../../utils/token.js';

function setRefreshCookie(res, rawRefreshToken) {
  res.cookie('refreshToken', rawRefreshToken, {
    httpOnly: true,
    secure: config.cookie.secure,
    // 'lax' for local same-site dev; production (different domains
    // for frontend/backend) needs 'none' — see Deployment doc's
    // SameSite gotcha. CSRF protection here comes from the header-based
    // access token, not this cookie, so this relaxation is deliberate.
    sameSite: config.isProduction ? 'none' : 'lax',
    domain: config.cookie.domain,
    maxAge: parseDuration(config.jwt.refreshExpiry),
    path: '/api/v1/auth',
  });
}

export async function register(req, res, next) {
  try {
    const { accessToken, rawRefreshToken, user } = await authService.register(req.body);
    setRefreshCookie(res, rawRefreshToken);
    res.status(201).json({
      success: true,
      data: { user: user.toPublicJSON(), accessToken },
    });
  } catch (err) {
    next(err);
  }
}

export async function login(req, res, next) {
  try {
    const { accessToken, rawRefreshToken, user } = await authService.login(req.body);
    setRefreshCookie(res, rawRefreshToken);
    res.json({
      success: true,
      data: { user: user.toPublicJSON(), accessToken },
    });
  } catch (err) {
    next(err);
  }
}

export async function refresh(req, res, next) {
  try {
    const raw = req.cookies?.refreshToken;
    const { accessToken, rawRefreshToken } = await authService.refresh(raw);
    setRefreshCookie(res, rawRefreshToken);
    res.json({ success: true, data: { accessToken } });
  } catch (err) {
    next(err);
  }
}

export async function logout(req, res, next) {
  try {
    const raw = req.cookies?.refreshToken;
    await authService.logout(raw);
    res.clearCookie('refreshToken', { path: '/api/v1/auth' });
    res.json({ success: true, data: { loggedOut: true } });
  } catch (err) {
    next(err);
  }
}
