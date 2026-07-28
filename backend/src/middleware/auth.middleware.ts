import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../lib/token';
import { AppError } from './error.middleware';
import { prisma } from '../lib/db';
import { Prisma } from '@prisma/client';


// The token proves who you are. It does NOT prove what you are still allowed to do: role and
// companyId were frozen into it when it was minted, and it lives for 15 minutes. Deleting an
// account or demoting someone revokes their refresh token, which does nothing to an access
// token already in their hands.
//
// That window was not merely 15 minutes long. A dismissed owner could spend it calling
// POST /api/invites/generate, which reads only req.user.role, and walk away with a code valid
// for 24 hours and 100 uses: sign up again, redeem it, and they are back inside the company
// that just removed them. A dismissed manager could spend it calling DELETE /api/employees/:id,
// which anonymises colleagues irreversibly.
//
// So the database decides, not the token. One primary key lookup per authenticated request,
// which is what requireAdmin below already does, generalised to every route.
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(new AppError(401, 'Token manquant.'));
    return;
  }

  let payload;
  try {
    payload = verifyAccessToken(header.slice(7));
  } catch {
    next(new AppError(401, 'Token invalide ou expiré.'));
    return;
  }

  // A subject that is not a UUID makes Prisma throw rather than return nothing. That is a bad
  // credential, not a server fault, so it answers 401 like any other unusable token. Every
  // other failure, a database being down for instance, must keep bubbling up as a 500: turning
  // an outage into a wave of 401s would log every user out for nothing.
  let user;
  try {
    user = await prisma.user.findFirst({
      where: { id: payload.sub, deletedAt: null },
      select: {
        id: true,
        role: true,
        companyId: true,
        company: { select: { deletedAt: true } },
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2023') {
      next(new AppError(401, 'Token invalide ou expiré.'));
      return;
    }
    throw err;
  }
  // Covers three cases at once: account gone, account anonymised, company removed underneath.
  if (!user || user.company?.deletedAt) {
    next(new AppError(401, 'Session invalide.'));
    return;
  }

  req.user = {
    id: user.id,
    role: user.role,
    ...(user.companyId ? { companyId: user.companyId } : {}),
  };
  next();
}


// Optional auth: populates req.user when a valid token is present, otherwise lets the request
// through as anonymous. Used on publicly readable routes that tailor their response to the
// caller's role, e.g. the offers showcase.
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next();
    return;
  }
  try {
    const payload = verifyAccessToken(header.slice(7));
    req.user = {
      id: payload.sub,
      role: payload.role,
      ...(payload.companyId ? { companyId: payload.companyId } : {}),
    };
  } catch {
    // Invalid/expired token: stay anonymous rather than reject.
  }
  next();
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  // The token says ADMIN, but role/status can change mid-session and the 15-min access token
  // would otherwise honor a stale role - re-check against the DB.
  if (req.user?.role !== 'ADMIN') {
    next(new AppError(403, 'Accès réservé aux administrateurs.'));
    return;
  }
  try {
    const user = await prisma.user.findFirst({
      where: { id: req.user.id, deletedAt: null },
      select: { role: true },
    });
    if (!user || user.role !== 'ADMIN') {
      next(new AppError(403, 'Accès réservé aux administrateurs.'));
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}
