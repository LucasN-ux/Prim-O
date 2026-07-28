import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../middleware/error.middleware';
import { createAttributionSchema, allocateSchema, distributeEnvelopeSchema } from '../schemas/attribution.schemas';
import {
  createAttribution,
  listAttributionsByCompany,
  allocateToManager,
  listCompanyManagers,
  distributeEnvelope,
  listManagerEnvelopes,
  getManagerBalances,
  listSentEnvelopes,
} from '../services/attribution.service';
import { requireManagerOrOwner } from '../middleware/authz';

// POST /api/attributions - direct token attribution to an employee (owner only; managers must
// go through their envelopes).
export async function createAttributionController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = requireManagerOrOwner(req, next);
    if (!ctx) return;

    if (ctx.role === 'MANAGER') {
      next(new AppError(403, 'Les managers distribuent via leurs enveloppes (/attributions/distribute).'));
      return;
    }

    const input = createAttributionSchema.parse(req.body);

    const attribution = await createAttribution(ctx.userId, ctx.companyId, input);
    res.status(201).json({ attribution });
  } catch (err) {
    if (err instanceof Error) {
      const map: Record<string, [number, string]> = {
        EMPLOYEE_NOT_FOUND:      [404, 'Employé introuvable.'],
        EMPLOYEE_NOT_IN_COMPANY: [403, "Cet employé n'appartient pas à votre entreprise."],
        COMPANY_NOT_FOUND:       [404, 'Entreprise introuvable.'],
        COMPANY_INACTIVE:        [403, 'Entreprise non validée.'],
        INSUFFICIENT_POOL:       [409, 'Solde de tokens insuffisant dans le pool entreprise.'],
      };
      const mapped = map[err.message];
      if (mapped) { next(new AppError(mapped[0], mapped[1])); return; }
    }
    next(err);
  }
}

// POST /api/attributions/allocate - the owner allocates tokens to a manager.
export async function allocateController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (req.user?.role !== 'OWNER') {
      next(new AppError(403, 'Seul le patron peut allouer des tokens à un manager.'));
      return;
    }
    const companyId = req.user.companyId;
    if (!companyId) {
      next(new AppError(403, 'Aucune entreprise associée.'));
      return;
    }
    const { managerId, amount, mode, percentage } = allocateSchema.parse(req.body);
    const { allocation, companyTokenBalance } = await allocateToManager(
      companyId, req.user.id, managerId, amount, mode, percentage ?? null,
    );
    res.status(201).json({
      allocationId: allocation.id,
      managerId,
      amount: allocation.amount,
      mode: allocation.mode,
      percentage: allocation.percentage,
      status: allocation.status,
      companyTokenBalance,
    });
  } catch (err) {
    if (err instanceof Error) {
      const map: Record<string, [number, string]> = {
        UNAUTHORIZED:           [403, 'Seul le patron peut allouer des tokens à un manager.'],
        MANAGER_NOT_FOUND:      [404, 'Manager introuvable.'],
        MANAGER_NOT_IN_COMPANY: [403, "Ce manager n'appartient pas à votre entreprise."],
        COMPANY_NOT_FOUND:      [404, 'Entreprise introuvable.'],
        COMPANY_INACTIVE:       [403, 'Entreprise non validée.'],
        INSUFFICIENT_POOL:      [409, 'Solde insuffisant dans le pool entreprise.'],
      };
      const mapped = map[err.message];
      if (mapped) { next(new AppError(mapped[0], mapped[1])); return; }
    }
    next(err);
  }
}

// POST /api/attributions/distribute - the manager distributes an envelope. One-shot: an
// envelope can only be distributed once.
export async function distributeEnvelopeController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = requireManagerOrOwner(req, next);
    if (!ctx) return;

    const input = distributeEnvelopeSchema.parse(req.body);
    const result = await distributeEnvelope(ctx.userId, ctx.companyId, input);
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof Error) {
      const map: Record<string, [number, string]> = {
        ALLOCATION_NOT_FOUND:           [404, 'Enveloppe introuvable.'],
        ALLOCATION_NOT_OWNED:           [403, "Cette enveloppe ne t'appartient pas."],
        ALLOCATION_NOT_IN_COMPANY:      [403, "Cette enveloppe n'appartient pas à ton entreprise."],
        ALLOCATION_ALREADY_DISTRIBUTED: [409, 'Cette enveloppe a déjà été distribuée.'],
        DISTRIBUTION_MISMATCH:          [422, "Le total distribué doit égaler le budget de l'enveloppe."],
        EMPLOYEE_INVALID:               [422, 'Un ou plusieurs employés sont invalides.'],
        MOTIF_INVALID:                  [422, 'Un ou plusieurs motifs sont invalides ou inactifs.'],
      };
      const mapped = map[err.message];
      if (mapped) { next(new AppError(mapped[0], mapped[1])); return; }
    }
    next(err);
  }
}

// GET /api/attributions/envelopes - the current manager's envelopes ("Mes enveloppes" view).
export async function listEnvelopesController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = requireManagerOrOwner(req, next);
    if (!ctx) return;
    const envelopes = await listManagerEnvelopes(ctx.userId, ctx.companyId);
    res.status(200).json({ envelopes });
  } catch (err) {
    next(err);
  }
}

// GET /api/attributions/sent-envelopes - envelopes sent by the current employer.
export async function listSentEnvelopesController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = requireManagerOrOwner(req, next);
    if (!ctx) return;
    const envelopes = await listSentEnvelopes(ctx.companyId, ctx.userId);
    res.status(200).json({ envelopes });
  } catch (err) {
    next(err);
  }
}

// GET /api/attributions/balances - the current manager's two balances (envelope remaining +
// personal tokens).
export async function balancesController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = requireManagerOrOwner(req, next);
    if (!ctx) return;
    const balances = await getManagerBalances(ctx.userId, ctx.companyId);
    res.status(200).json(balances);
  } catch (err) {
    next(err);
  }
}

// GET /api/attributions/managers - the company's managers (owner allocation view).
export async function listManagersController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = requireManagerOrOwner(req, next);
    if (!ctx) return;
    const managers = await listCompanyManagers(ctx.companyId);
    res.status(200).json({ managers });
  } catch (err) {
    next(err);
  }
}

// GET /api/attributions - attribution history for the caller's company.
export async function listAttributionsController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const ctx = requireManagerOrOwner(req, next);
    if (!ctx) return;

    // A manager only sees their own attributions; the owner keeps the company-wide view.
    const attributions = await listAttributionsByCompany(
      ctx.companyId,
      ctx.role === 'MANAGER' ? ctx.userId : undefined,
    );
    res.status(200).json({ attributions });
  } catch (err) {
    next(err);
  }
}
