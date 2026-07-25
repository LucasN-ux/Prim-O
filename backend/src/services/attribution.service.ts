import { prisma } from '../lib/db';
import { Prisma } from '@prisma/client';
import type { RetributionMode } from '@prisma/client';
import type { CreateAttributionInput, DistributeEnvelopeInput } from '../schemas/attribution.schemas';
import { computeRetribution } from '../lib/retribution';

// Direct owner → employee send (small-company flow): debits the company POOL, credits the
// employee and records the motif (allocation reason). Atomic + guarded. OWNER only -
// managers go through envelopes (see distributeEnvelope).
export async function createAttribution(
  attributorId: string,
  companyId: string,
  input: CreateAttributionInput,
) {
  const { employeeId, amount, motifId } = input;

  const employee = await prisma.user.findUnique({
    where: { id: employeeId },
    select: { id: true, role: true, companyId: true, deletedAt: true },
  });

  if (!employee || employee.deletedAt !== null || employee.role !== 'EMPLOYEE') {
    throw new Error('EMPLOYEE_NOT_FOUND');
  }
  if (employee.companyId !== companyId) {
    throw new Error('EMPLOYEE_NOT_IN_COMPANY');
  }

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { status: true },
  });
  if (!company) throw new Error('COMPANY_NOT_FOUND');
  if (company.status !== 'APPROVED') throw new Error('COMPANY_INACTIVE');

  try {
    return await prisma.$transaction(async (tx) => {
      const debit = await tx.company.updateMany({
        where: { id: companyId, tokenBalance: { gte: amount } },
        data: { tokenBalance: { decrement: amount } },
      });
      if (debit.count === 0) throw new Error('INSUFFICIENT_POOL');

      await tx.user.update({
        where: { id: employeeId },
        data: { balance: { increment: amount } },
      });

      return tx.attribution.create({
        data: { amount, motifId, companyId, managerId: attributorId, employeeId },
        select: { id: true, amount: true, createdAt: true },
      });
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientUnknownRequestError &&
      err.message.includes('company_pool_non_negative')
    ) {
      throw new Error('INSUFFICIENT_POOL');
    }
    throw err;
  }
}

// Owner → manager allocation: debits the company POOL and CREATES an envelope (Allocation,
// status A_DISTRIBUER). Does NOT credit the manager's balance anymore: the tokens live in
// the envelope until distribution, when the retribution R is credited. Atomic + guarded.
export async function allocateToManager(
  companyId: string,
  createdById: string,
  managerId: string,
  amount: number,
  mode: RetributionMode,
  percentage: number | null,
) {
  const creator = await prisma.user.findUnique({
    where: { id: createdById },
    select: { id: true, role: true, companyId: true },
  });
  if (!creator || creator.role !== 'OWNER' || creator.companyId !== companyId) {
    throw new Error('UNAUTHORIZED');
  }

  const manager = await prisma.user.findUnique({
    where: { id: managerId },
    select: { id: true, role: true, companyId: true, deletedAt: true },
  });
  if (!manager || manager.deletedAt !== null || manager.role !== 'MANAGER') {
    throw new Error('MANAGER_NOT_FOUND');
  }
  if (manager.companyId !== companyId) throw new Error('MANAGER_NOT_IN_COMPANY');

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { status: true },
  });
  if (!company) throw new Error('COMPANY_NOT_FOUND');
  if (company.status !== 'APPROVED') throw new Error('COMPANY_INACTIVE');

  try {
    return await prisma.$transaction(async (tx) => {
      const debit = await tx.company.updateMany({
        where: { id: companyId, tokenBalance: { gte: amount } },
        data: { tokenBalance: { decrement: amount } },
      });
      if (debit.count === 0) throw new Error('INSUFFICIENT_POOL');

      const allocation = await tx.allocation.create({
        data: { amount, mode, percentage, companyId, managerId, createdById, status: 'A_DISTRIBUER' },
        select: { id: true, amount: true, mode: true, percentage: true, status: true },
      });
      const refreshed = await tx.company.findUnique({
        where: { id: companyId },
        select: { tokenBalance: true },
      });
      return { allocation, companyTokenBalance: refreshed?.tokenBalance ?? 0 };
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientUnknownRequestError &&
      err.message.includes('company_pool_non_negative')
    ) {
      throw new Error('INSUFFICIENT_POOL');
    }
    throw err;
  }
}

// Atomic envelope distribution: recomputes R, checks the invariant Σ(line amounts) =
// amount − R, credits the manager (R) and each employee, marks the envelope DISTRIBUEE.
// Any failure rolls back everything and the envelope stays A_DISTRIBUER.
export async function distributeEnvelope(
  managerId: string,
  companyId: string,
  input: DistributeEnvelopeInput,
) {
  const { allocationId, lines } = input;
  return prisma.$transaction(async (tx) => {
    const alloc = await tx.allocation.findUnique({
      where: { id: allocationId },
      select: { id: true, amount: true, mode: true, percentage: true, status: true, managerId: true, companyId: true },
    });
    if (!alloc) throw new Error('ALLOCATION_NOT_FOUND');
    if (alloc.managerId !== managerId) throw new Error('ALLOCATION_NOT_OWNED');
    if (alloc.companyId !== companyId) throw new Error('ALLOCATION_NOT_IN_COMPANY');
    if (alloc.status !== 'A_DISTRIBUER') throw new Error('ALLOCATION_ALREADY_DISTRIBUTED');

    // Team size = the company's active employees at distribution time (the manager counts as +1).
    const teamSize = await tx.user.count({
      where: { companyId, role: 'EMPLOYEE', deletedAt: null },
    });
    const retribution = computeRetribution({
      mode: alloc.mode,
      amount: alloc.amount,
      percentage: alloc.percentage,
      teamSize,
    });
    const budget = alloc.amount - retribution;

    const total = lines.reduce((sum, l) => sum + l.amount, 0);
    if (total !== budget) throw new Error('DISTRIBUTION_MISMATCH');

    // Every recipient must be an active employee of the company.
    const employeeIds = lines.map((l) => l.employeeId);
    const validEmployees = await tx.user.count({
      where: { id: { in: employeeIds }, companyId, role: 'EMPLOYEE', deletedAt: null },
    });
    if (validEmployees !== employeeIds.length) throw new Error('EMPLOYEE_INVALID');

    // Every motif must exist and be active.
    const motifIds = [...new Set(lines.map((l) => l.motifId))];
    const validMotifs = await tx.motif.count({ where: { id: { in: motifIds }, active: true } });
    if (validMotifs !== motifIds.length) throw new Error('MOTIF_INVALID');

    // Credit the retribution R to the manager's personal balance.
    if (retribution > 0) {
      await tx.user.update({ where: { id: managerId }, data: { balance: { increment: retribution } } });
    }
    // Credit each employee and record the attributions, linked to the envelope.
    for (const l of lines) {
      await tx.user.update({ where: { id: l.employeeId }, data: { balance: { increment: l.amount } } });
      await tx.attribution.create({
        data: {
          amount: l.amount,
          motifId: l.motifId,
          companyId,
          managerId,
          employeeId: l.employeeId,
          allocationId,
        },
      });
    }
    await tx.allocation.update({
      where: { id: allocationId },
      data: { status: 'DISTRIBUEE', retributionAmount: retribution, distributedAt: new Date() },
    });

    return { allocationId, retributionAmount: retribution, distributed: total, lineCount: lines.length, status: 'DISTRIBUEE' as const };
  });
}

// A manager's envelopes ("Mes enveloppes" screen). For A_DISTRIBUER, R and the budget are
// computed live from the current team size; for DISTRIBUEE we read back the R frozen at
// distribution time.
export async function listManagerEnvelopes(managerId: string, companyId: string) {
  const allocations = await prisma.allocation.findMany({
    where: { managerId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, amount: true, mode: true, percentage: true, status: true,
      retributionAmount: true, distributedAt: true, createdAt: true,
    },
  });
  const teamSize = await prisma.user.count({ where: { companyId, role: 'EMPLOYEE', deletedAt: null } });
  return allocations.map((a) => {
    const retribution = a.status === 'DISTRIBUEE'
      ? a.retributionAmount
      : computeRetribution({ mode: a.mode, amount: a.amount, percentage: a.percentage, teamSize });
    return {
      allocationId: a.id,
      amount: a.amount,
      mode: a.mode,
      percentage: a.percentage,
      status: a.status,
      retributionAmount: retribution,
      distributableBudget: a.amount - retribution,
      distributedAt: a.distributedAt?.toISOString() ?? null,
      createdAt: a.createdAt.toISOString(),
    };
  });
}

// Envelopes SENT by an owner ("Sent envelopes" screen): filtered by createdById,
// with the recipient manager. Read-only, no R computation.
export async function listSentEnvelopes(companyId: string, createdById: string) {
  const allocations = await prisma.allocation.findMany({
    where: { companyId, createdById },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, amount: true, mode: true, percentage: true, status: true,
      retributionAmount: true, distributedAt: true, createdAt: true,
      manager: { select: { firstName: true, lastName: true } },
    },
  });
  return allocations.map((a) => ({
    allocationId: a.id,
    amount: a.amount,
    mode: a.mode,
    percentage: a.percentage,
    status: a.status,
    retributionAmount: a.retributionAmount,
    managerName: `${a.manager.firstName ?? ''} ${a.manager.lastName ?? ''}`.trim(),
    distributedAt: a.distributedAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
  }));
}

// The manager's two balances (§3.3): remaining envelope budget (undistributed A_DISTRIBUER
// envelopes) plus personal balance (accumulated retribution = user.balance).
export async function getManagerBalances(managerId: string, companyId: string) {
  const user = await prisma.user.findUnique({ where: { id: managerId }, select: { balance: true } });
  const pending = await prisma.allocation.findMany({
    where: { managerId, status: 'A_DISTRIBUER' },
    select: { amount: true, mode: true, percentage: true },
  });
  const teamSize = await prisma.user.count({ where: { companyId, role: 'EMPLOYEE', deletedAt: null } });
  const envelopeRemaining = pending.reduce((sum, a) => {
    const r = computeRetribution({ mode: a.mode, amount: a.amount, percentage: a.percentage, teamSize });
    return sum + (a.amount - r);
  }, 0);
  return { envelopeRemaining, personalBalance: user?.balance ?? 0 };
}

// Managers of a company, for the owner's allocation screen.
export async function listCompanyManagers(companyId: string) {
  return prisma.user.findMany({
    where: { companyId, role: 'MANAGER', deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, firstName: true, lastName: true, email: true, balance: true },
  });
}

// Company attribution history, newest first.
// Optional `managerId` restricts the list to that manager's own attributions (a manager
// only sees theirs; the owner, unfiltered, keeps the full company view).
// `reason` is derived from the motif - free-text reasons no longer exist - to stay
// compatible with the existing display.
export async function listAttributionsByCompany(companyId: string, managerId?: string) {
  const rows = await prisma.attribution.findMany({
    where: { companyId, ...(managerId ? { managerId } : {}) },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      amount: true,
      createdAt: true,
      employee: { select: { firstName: true, lastName: true } },
      motif: { select: { label: true } },
    },
  });
  return rows.map(({ motif, ...a }) => ({ ...a, reason: motif?.label ?? '' }));
}
