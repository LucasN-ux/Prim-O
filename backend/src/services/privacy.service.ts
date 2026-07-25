import bcrypt from 'bcrypt'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/db';
import { refundPendingEnvelopes } from './attribution.service';
import type { UpdateProfileInput } from '../schemas/privacy.schemas';

// GDPR: right of access/portability (art. 15 & 20) and right to erasure (art. 17).
// Erasure means ANONYMIZATION, not physical deletion: the accounting ledger
// (Attribution/Redemption) is kept while the person's identity is detached
// (recital 26: anonymous data falls outside the GDPR).

// Full personal-data export as portable JSON. NEVER includes passwordHash.

export async function exportUserData(userId: string) {
    const user = await prisma.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            balance: true,
            isEmailVerified: true,
            createdAt: true,
            updatedAt: true,
            company: { select: { name: true } },
        },
    });

    if (!user) {
        throw new Error('USER_NOT_FOUND');
    }

    const [attributionReceived, attributionSent, redemptions] = await Promise.all([
        prisma.attribution.findMany({
            where: { employeeId: userId },
            orderBy: { createdAt: 'desc' },
            select: {
                amount: true,
                createdAt: true,
                manager: { select: { firstName: true, lastName: true } },
                motif: { select: { label: true } },
            },
        }),
        prisma.attribution.findMany({
            where: { managerId: userId},
            orderBy: { createdAt: 'desc'},
            select: {
                amount: true,
                createdAt: true,
                employee: { select: { firstName: true, lastName: true } },
                motif: { select: { label: true } },
            },
        }),
        prisma.redemption.findMany({
            where: { employeeId: userId },
            orderBy: { createdAt: 'desc' },
            select: {
                amount: true,
                createdAt: true,
                offer: { select: { partnerName: true } },
                promoCode: { select: { code: true } },
            },
        }),
    ]);

    return {
        exportedAt: new Date().toISOString(),
        profile: {
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
            balance: user.balance,
            isEmailVerified: user.isEmailVerified,
            companyName: user.company?.name ?? null,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
        },
        attributionsReceived: attributionReceived.map((a) => ({
            amount: a.amount,
            reason: a.motif?.label ?? '',
            createdAt: a.createdAt,
            managerName: `${a.manager.firstName ?? ''} ${a.manager.lastName ?? ''}`.trim(),
        })),
        attributionsSent: attributionSent.map((a) => ({
            amount: a.amount,
            reason: a.motif?.label ?? '',
            createdAt: a.createdAt,
            employeeName: `${a.employee.firstName ?? ''} ${a.employee.lastName ?? ''}`.trim(),
        })),
        redemptions: redemptions.map((r) => ({
            amount: r.amount,
            createdAt: r.createdAt,
            offerName: r.offer.partnerName,
            promoCode: r.promoCode.code,
        })),
    };
}


// Anonymizes a user INSIDE a caller-provided transaction (shared by self-service
// deletion AND the manager-side soft delete).
//  - email: unique non-identifying value (the uuid avoids collisions; deletedAt takes
//    the row out of the partial unique index, so the email can register again)
//  - first/last name cleared
//  - passwordHash emptied -> login becomes impossible
//  - auth tokens deleted (no historical value)
// role/companyId/balance are kept: the ledger references this User row.
export async function anonymizeUser(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    // Before detaching the identity: hand any undistributed envelope back to the company,
    // otherwise those tokens are stranded on an account nobody can log into ever again.
    await refundPendingEnvelopes(tx, userId);

    await tx.user.update({
        where: { id: userId },
        data: {
            email: `deleted-${userId}@anonymized.local`,
            firstName: null,
            lastName: null,
            passwordHash: '',
            isEmailVerified: false,
            // What the person earned is spent or lost with the account. It does NOT go back
            // to the employer, so removing someone never pays off for the company.
            balance: 0,
            deletedAt: new Date(),
        },
    });

    await tx.refreshToken.deleteMany({ where: { userId } });
    await tx.emailVerificationToken.deleteMany({ where: { userId } });
}

// Profile rectification (art. 16). Partial update: only the provided fields are
// touched. Changing the email is the sensitive case (uniqueness + re-verification).
export async function updateOwnProfile(userId: string, input: UpdateProfileInput) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, email: true, role: true },
  });
  if (!user) {
    throw new Error('USER_NOT_FOUND');
  }

  const data: {
    firstName?: string; lastName?: string; email?: string;
    isEmailVerified?: boolean; profilePhoto?: string | null;
  } = {};
  if (input.firstName !== undefined) data.firstName = input.firstName;
  if (input.lastName !== undefined) data.lastName = input.lastName;
  if (input.profilePhoto !== undefined) data.profilePhoto = input.profilePhoto;

  if (input.email !== undefined && input.email !== user.email) {
    const newEmail = input.email; // Local const keeps TS's string narrowing.
    const taken = await prisma.user.findFirst({
      where: { email: newEmail, deletedAt: null, NOT: { id: userId } },
      select: { id: true },
    });
    if (taken) throw new Error('EMAIL_TAKEN');

    data.email = newEmail;
    // An EMPLOYEE who changes email must be re-approved by their manager (the
    // « Approuver » button flips isEmailVerified back to true). For a MANAGER the
    // flag is left alone: they have no re-approval path and would be locked out at
    // login. Real link-based verification will come with Brevo.
    if (user.role === 'EMPLOYEE') {
      data.isEmailVerified = false;
    }
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data,
    select: {
      id: true, email: true, firstName: true, lastName: true,
      role: true, isEmailVerified: true, profilePhoto: true,
    },
  });

  return updated;
}


// Self-service account deletion: requires the password to confirm an
// irreversible action.
export async function deleteOwnAccount(userId: string, password: string): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, passwordHash: true },
  });
  if (!user) {
    throw new Error('USER_NOT_FOUND');
  }

  const validPassword = await bcrypt.compare(password, user.passwordHash);
  if (!validPassword) {
    throw new Error('INVALID_PASSWORD');
  }

  await prisma.$transaction(async (tx) => {
    await anonymizeUser(tx, userId);
  });
}

// Profile of the signed-in user (pre-fills the rectification form).
// Never includes passwordHash.
export async function getMyProfile(userId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, email: true, firstName: true, lastName: true, role: true, isEmailVerified: true, profilePhoto: true },
  });
  if (!user) {
    throw new Error('USER_NOT_FOUND');
  }
  return user;
}
