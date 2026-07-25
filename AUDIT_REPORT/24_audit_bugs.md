# Audit ULTRA-Approfondi Prim'O - Bugs Trouvés

## BUG #1: REDEMPTION ALLOWS REJECTED COMPANIES
**File**: `/home/mateo/prim-o/backend/src/services/redemption.service.ts` (line 6-68)
**Severity**: CRITICAL
**Scenario**: 
1. Company A is APPROVED, user joins as EMPLOYEE
2. Admin sets company status to REJECTED
3. Employee calls POST /api/employees/me/redeem
4. No check for company.status!
**Current Behavior**: Redemption succeeds even if company is REJECTED
**Expected**: Should throw COMPANY_INACTIVE (like createAttribution does)
**Impact Business**: Tokens leak from REJECTED companies

## BUG #2: TEAMSIZE = 0 CRITICAL LOGIC BUG
**File**: `/home/mateo/prim-o/backend/src/lib/retribution.ts` (line 15)
**Severity**: CRITICAL
**Scenario**: 
1. Company has 1 employee + 1 manager
2. All employees are soft-deleted (deletedAt != null)
3. Manager tries to distribute an allocation in PART_EGALE mode
4. teamSize = 0 (no active employees)
5. Retribution = Math.floor(amount / (0 + 1)) = amount
6. Manager gets 100% of envelope!
**Current Behavior**: With teamSize=0, manager gets entire envelope
**Expected**: Should error or require minimum 1 employee
**Impact Business**: Budget theft via employee removal

## BUG #3: JOIN COMPANY ALLOWS REJECTED COMPANIES
**File**: `/home/mateo/prim-o/backend/src/services/auth.service.ts` (line 87-113)
**Severity**: CRITICAL
**Scenario**: 
1. Company A is APPROVED, code ABCDEFGHJKMN generated
2. Admin sets company to REJECTED
3. User calls POST /api/auth/join-company with code
4. Raw SQL only checks: revokedAt IS NULL, expiresAt > now(), usedCount < maxUses
5. NO check for company.status!
**Current Behavior**: joinCompany succeeds even if company REJECTED
**Expected**: Should verify company.status = 'APPROVED' before updating user
**Impact Business**: Users can join and operate in REJECTED companies

## BUG #4: DELETED USERS CAN STILL USE ACCESS TOKENS
**File**: `/home/mateo/prim-o/backend/src/middleware/auth.middleware.ts` (line 7-25)
**Severity**: CRITICAL
**Scenario**:
1. User soft-deleted (deletedAt != null)
2. Access token still valid (15 min TTL)
3. User can call: GET /api/employees/me, POST /api/employees/me/redeem, etc.
4. `requireAuth` only verifies token signature, NOT deletedAt!
**Current Behavior**: Deleted users can use valid access tokens
**Expected**: requireAuth should check user.deletedAt IS NULL (like requireAdmin does)
**Impact Business**: Deleted accounts leak data and spend budget

## BUG #5: REJECT JOINED USERS STILL USE TOKENS
**File**: `/home/mateo/prim-o/backend/src/services/auth.service.ts` (line 87-113)
**Severity**: CRITICAL
**Scenario**:
1. User joins company A (APPROVED) via invite code
2. Access token generated with companyId=A
3. Admin sets company A to REJECTED
4. User calls redemption/allocation endpoints
5. requireManagerOrOwner checks role, not company.status!
**Current Behavior**: Users of REJECTED companies keep using their tokens
**Expected**: Should verify company.status = APPROVED (not just role)
**Impact Business**: Operates in REJECTED companies

## TO-CHECK NEXT:
- Race condition on simultaneous redemptions
- Attribution without valid motif
- Allocation without checking manager's role change
- Soft-deleted users in Allocation.managerId FK
- Percentage null in POURCENTAGE mode
- Deleted offer still used in Allocation
- Manager demoted mid-distribution
- Employee deleted while allocation pending
