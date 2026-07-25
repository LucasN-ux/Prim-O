import { prisma } from '../lib/db';
import { Prisma } from '@prisma/client';
import { refundPendingEnvelopes } from './attribution.service';
import type { 
  ListUsersQuery, 
  UpdateUserInput, 
  PaginationQuery, 
  CreateCompanyInput 
} from '../schemas/admin.schemas';


// Global dashboard stats for the admin (not scoped to one company).
export async function getStats() {
  const [companies, users, managers] = await Promise.all([
    prisma.company.count({ where: { deletedAt: null } }),
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.user.count({ where: { deletedAt: null, role: 'MANAGER' } }),
  ]);
  return { companies, users, managers };
}

export async function listCompanies(q: PaginationQuery) {
  const where = { deletedAt: null };
  const [items, total] = await Promise.all([
    prisma.company.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      select: {
        id: true, name: true, tokenBalance: true, status: true, createdAt: true,
        _count: { select: { users: true } },
      },
    }),
    prisma.company.count({ where }),
  ]);
  return { items, total, page: q.page, hasMore: q.page * q.limit < total };
}

// Global ledger: every token attribution across ALL companies (admin view).
export async function listAttributions(q: PaginationQuery) {
  const where = {}; // Deliberately unfiltered: the admin ledger spans all companies.
  const [items, total] = await Promise.all([
    prisma.attribution.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      select: {
        id: true,
        amount: true,
        createdAt: true,
        company:  { select: { name: true } },
        manager:  { select: { firstName: true, lastName: true } },
        employee: { select: { firstName: true, lastName: true } },
        motif:    { select: { label: true } },
      },
    }),
    prisma.attribution.count({ where }),
  ]);
  // `reason` is the motif label - free-text reasons no longer exist.
  const mapped = items.map(({ motif, ...a }) => ({ ...a, reason: motif?.label ?? '' }));
  return { items: mapped, total, page: q.page, hasMore: q.page * q.limit < total };
}


export async function createCompany(data: CreateCompanyInput) {
  return prisma.company.create({
    // Admin-created companies skip the approval queue: APPROVED from the start.
    data: { name: data.name, status: 'APPROVED' },
    select: { id: true, name: true, tokenBalance: true, status: true, createdAt: true },
  });
}

// Company vetting (admin approval queue): PENDING -> APPROVED/REJECTED.
export async function setCompanyStatus(companyId: string, status: 'APPROVED' | 'REJECTED') {
  const company = await prisma.company.findFirst({
    where: { id: companyId, deletedAt: null },
    select: { id: true },
  });
  if (!company) throw new Error('COMPANY_NOT_FOUND');
  return prisma.company.update({
    where: { id: companyId },
    data: { status },
    select: { id: true, name: true, status: true },
  });
}

// Soft-delete a company and everything tied to it, atomically.
// Keeps the append-only ledgers (Attribution/Redemption/CompanyTokenPurchase)
// intact for audit - we only flag deletedAt and kill sessions.
export async function softDeleteCompany(companyId: string) {
  return prisma.$transaction(async (tx) => {
    const company = await tx.company.findFirst({
      where: { id: companyId, deletedAt: null }, // Missing and already-deleted both yield 404.
      select: { id: true },
    });
    if (!company) throw new Error('COMPANY_NOT_FOUND');

    const now = new Date();

    // Collect user ids first so their refresh tokens can be targeted below.
    const users = await tx.user.findMany({
      where: { companyId, deletedAt: null },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);

    // Soft-delete the users; this frees their emails via the partial unique index.
    await tx.user.updateMany({
      where: { companyId, deletedAt: null },
      data: { deletedAt: now },
    });

    // Revoke refresh tokens so no session outlives the 15-minute access-token TTL.
    if (userIds.length > 0) {
      await tx.refreshToken.updateMany({
        where: { userId: { in: userIds }, isRevoked: false },
        data: { isRevoked: true },
      });
    }

    // Revoke live invite codes so nobody can sign up into a deleted company.
    await tx.companyInviteCode.updateMany({
      where: { companyId, revokedAt: null },
      data: { revokedAt: now },
    });

    await tx.company.update({
      where: { id: companyId },
      data: { deletedAt: now },
    });

    return { companyId, usersDeleted: userIds.length };
  });
}

// Reverse a cascade soft-delete. Only restores users killed by THIS
// company-deletion (same deletedAt timestamp). Sessions stay revoked:
// users must log in again - safer, and the tokens were short-lived anyway.
export async function restoreCompany(companyId: string) {
  return prisma.$transaction(async (tx) => {
    const company = await tx.company.findFirst({
      where: { id: companyId, deletedAt: { not: null } },
      select: { id: true, deletedAt: true },
    });
    if (!company) throw new Error('COMPANY_NOT_DELETED'); // Missing or still active.

    const deletedAt = company.deletedAt!; // Non-null: the query filters on deletedAt != null.

    const usersToRestore = await tx.user.findMany({
      where: { companyId, deletedAt }, // Only users removed by this exact cascade.
      select: { id: true, email: true },
    });

    // Guard: while the company was dead, someone may have re-registered
    // with the same email (now an ACTIVE row). Restoring would create two
    // active rows sharing an email -> violates the partial unique index.
    // Catch it first to return a clear error instead of a raw P2002 500.
    const emails = usersToRestore.map((u) => u.email);
    const clashes = await tx.user.findMany({
      where: { email: { in: emails }, deletedAt: null },
      select: { email: true },
    });
    if (clashes.length > 0) {
      throw new Error(`EMAIL_TAKEN:${clashes.map((c) => c.email).join(', ')}`);
    }

    await tx.user.updateMany({
      where: { companyId, deletedAt },
      data: { deletedAt: null },
    });
    await tx.company.update({
      where: { id: companyId },
      data: { deletedAt: null },
    });

    return { companyId, usersRestored: usersToRestore.length };
  });
}

// Single source of truth for what an admin may see about a user.
// passwordHash is NOT here - never leak it.
const ADMIN_SAFE_SELECT = {
  id: true, email: true, role: true,
  firstName: true, lastName: true, balance: true,
  isEmailVerified: true, companyId: true, createdAt: true,
} as const;

export async function listUsers(q: ListUsersQuery) {
  const where: Prisma.UserWhereInput = { deletedAt: null };
  if (q.role)      where.role = q.role;
  if (q.companyId) where.companyId = q.companyId;
  if (q.search)    where.email = { contains: q.search, mode: 'insensitive' };

  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where, orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.limit, take: q.limit,
      select: ADMIN_SAFE_SELECT,
    }),
    prisma.user.count({ where }),
  ]);
  return { items, total, page: q.page, hasMore: q.page * q.limit < total };
}

export async function updateUser(id: string, data: UpdateUserInput) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, role: true, companyId: true },
    });
    if (!user) throw new Error('USER_NOT_FOUND');

    // isEmailVerified-only patch: no role/company guards needed.
    if (data.isEmailVerified !== undefined && data.role === undefined) {
      return tx.user.update({
        where: { id }, data: { isEmailVerified: data.isEmailVerified },
        select: ADMIN_SAFE_SELECT,
      });
    }

    const nextRole = data.role!;

    // This endpoint only assigns MANAGER/EMPLOYEE (never ADMIN - no privilege escalation),
    // and a non-ADMIN role always requires a company.
    if (user.companyId === null) {
      throw new Error('ROLE_REQUIRES_COMPANY');
    }

    // Last-admin guard: demoting the last active admin is forbidden.
    const losesAdmin = user.role === 'ADMIN';
    if (losesAdmin) {
      const admins = await tx.user.count({
        where: { role: 'ADMIN', deletedAt: null },
      });
      if (admins <= 1) throw new Error('LAST_ADMIN');
    }

    const updateData: { role: 'MANAGER' | 'EMPLOYEE'; isEmailVerified?: boolean } = { role: nextRole };
    if (data.isEmailVerified !== undefined) updateData.isEmailVerified = data.isEmailVerified;

    const updated = await tx.user.update({
      where: { id }, data: updateData,
      select: ADMIN_SAFE_SELECT,
    });

    // Role changed: revoke sessions so tokens carrying the stale role die.
    if (nextRole !== user.role) {
      await tx.refreshToken.updateMany({
        where: { userId: id, isRevoked: false }, data: { isRevoked: true },
      });
    }
    return updated;
  });
}

export async function softDeleteUser(id: string) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, role: true },
    });
    if (!user) throw new Error('USER_NOT_FOUND');

    if (user.role === 'ADMIN') {
      const admins = await tx.user.count({
        where: { role: 'ADMIN', deletedAt: null },
      });
      if (admins <= 1) throw new Error('LAST_ADMIN');
    }

    // Same rule as the GDPR anonymization: an undistributed envelope goes back to the
    // company pool, the personal balance dies with the account.
    await refundPendingEnvelopes(tx, id);

    await tx.user.update({ where: { id }, data: { balance: 0, deletedAt: new Date() } });
    await tx.refreshToken.updateMany({
      where: { userId: id, isRevoked: false }, data: { isRevoked: true },
    });
    return { id };
  });
}

// Global ledger: every redemption (offer purchase) across ALL companies.
export async function listRedemptions(q: PaginationQuery) {
  const where = {};
  const [items, total] = await Promise.all([
    prisma.redemption.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      select: {
        id: true,
        amount: true,
        createdAt: true,
        company:   { select: { name: true } },
        employee:  { select: { firstName: true, lastName: true } },
        offer:     { select: { partnerName: true } },
        promoCode: { select: { code: true } },
      },
    }),
    prisma.redemption.count({ where }),
  ]);
  return { items, total, page: q.page, hasMore: q.page * q.limit < total };
}

// Global ledger: every Stripe top-up recorded in DB (admin view).
// stripeSessionId != null keeps only real Stripe payments and excludes any
// manual credits recorded without a session.
export async function listPurchases(q: PaginationQuery) {
  const where: Prisma.CompanyTokenPurchaseWhereInput = { stripeSessionId: { not: null } };
  const [items, total] = await Promise.all([
    prisma.companyTokenPurchase.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      select: {
        id: true,
        amount: true,
        note: true,
        stripeSessionId: true,
        createdAt: true,
        company:   { select: { name: true } },
        createdBy: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.companyTokenPurchase.count({ where }),
  ]);
  return { items, total, page: q.page, hasMore: q.page * q.limit < total };
}
