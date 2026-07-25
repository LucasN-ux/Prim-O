# Quick Reference - Path Traversal Audit Results

## One-Line Summary
**Good architecture (server-side filename generation) but 2 fixes needed: symlink detection + URL encoding.**

---

## Vulnerabilities Found

| ID | Type | Location | Severity | Fix Status |
|----|------|----------|----------|-----------|
| V1 | Symlink Traversal | upload.ts:44-45 | **MEDIUM** | Needs fs.lstat() |
| V2 | Double URL Encoding | upload.ts:43 | **LOW** | Needs decodeURIComponent() |
| V3 | Loose Permissions | backend/uploads | **LOW** | Needs chmod 750 |

---

## Attack Vectors

### V1: Symlink Traversal (Medium)
```
Attacker creates: ln -s /etc backend/uploads/offers/pw
Calls API: DELETE /api/admin/offers/{id}/image
Backend: Follows symlink, deletes /etc/passwd
```
**Fix**: Add `fs.lstat(abs).isSymbolicLink()` check before `fs.unlink()`

### V2: Double URL Encoding (Low)
```
URL: /uploads/offers/..%252f..%252fetc%252fpasswd
Not decoded by removeUploadedFile()
Literal filename check fails → safe (accidentally)
```
**Fix**: Add `decodeURIComponent()` to normalize paths

### V3: Directory Permissions (Low)
```
Permissions: 755 (rwxr-xr-x)
Risk: Any OS user can read uploaded files
```
**Fix**: `chmod 750` (rwxr-x---)

---

## Positives (Things Working Well)

| Component | Status | Why |
|-----------|--------|-----|
| Filename Generation | ✓ SECURE | crypto.randomUUID() (server-side) |
| Path Traversal Check | ✓ SECURE | startsWith() validation |
| Archive Extraction | ✓ SECURE | No zip/tar operations |
| Access Control | ✓ SECURE | requireAuth + requireAdmin |
| DB Isolation | ✓ SECURE | imageUrl from server only |
| Static Serving | ✓ SECURE | express.static() has protections |
| Temp Files | ✓ SECURE | diskStorage (no temp), cleanup on error |

---

## Files to Fix

### Primary Fix
```
File: /home/mateo/prim-o/backend/src/lib/upload.ts
Lines: 42-47 (removeUploadedFile function)
Changes: Add fs.lstat() + decodeURIComponent()
```

### Secondary Fix
```
File: Dockerfile or startup script
Change: chmod 750 backend/uploads backend/uploads/offers
```

---

## Code to Add (Copy-Paste)

### In removeUploadedFile():

```typescript
export async function removeUploadedFile(imageUrl: string): Promise<void> {
  try {
    // Normalize URL encoding
    const rel = decodeURIComponent(
      imageUrl.replace(/^\/uploads\//, '')
    );
    const abs = path.join(UPLOADS_DIR, rel);
    
    // Path traversal check
    if (abs !== UPLOADS_DIR && !abs.startsWith(UPLOADS_DIR + path.sep)) {
      console.warn(`[SECURITY] Path traversal blocked: ${imageUrl}`);
      return;
    }
    
    // Symlink detection (NEW)
    const stats = await fs.lstat(abs);
    if (stats.isSymbolicLink()) {
      console.warn(`[SECURITY] Symlink deletion blocked: ${abs}`);
      return;
    }
    
    await fs.unlink(abs);
  } catch (err) {
    // File not found or lstat failed - ignore
  }
}
```

### In Dockerfile:

```dockerfile
RUN mkdir -p /app/backend/uploads/offers && \
    chmod 750 /app/backend/uploads && \
    chmod 750 /app/backend/uploads/offers
```

---

## Routes Affected

| Route | Method | Vulnerability | Status |
|-------|--------|----------------|--------|
| /api/admin/offers/{id}/image | POST | N/A (multer generates filename) | ✓ SECURE |
| /api/admin/offers/{id}/image | DELETE | V1 (symlink), V2 (encoding) | ⚠ NEEDS FIX |
| /api/uploads/* | GET | N/A (express.static protects) | ✓ SECURE |

---

## Risk Assessment

### Without Fixes
- **Practical Risk**: Medium (requires OS-level compromise to create symlinks)
- **Exploitability**: Low (attacker needs write access to /uploads)
- **Impact**: High (if exploited, can delete OS files)

### With Fixes
- **Risk**: Minimal (defense-in-depth)
- **Security**: Strong (multiple validation layers)

---

## Time to Fix

| Task | Time |
|------|------|
| Update upload.ts (both fixes) | 10 min |
| Add chmod to Dockerfile | 5 min |
| Test (curl requests) | 10 min |
| Review & QA | 10 min |
| **Total** | **~35 min** |

---

## Testing Commands

```bash
# After fix, verify uploads still work
curl -X PATCH http://localhost:4000/api/admin/offers/{id}/image \
  -H "Authorization: Bearer {token}" \
  -F "image=@test.jpg"

# Verify deletion works
curl -X DELETE http://localhost:4000/api/admin/offers/{id}/image \
  -H "Authorization: Bearer {token}"

# Verify permissions
ls -la backend/uploads
# Should show: drwxr-x--- or 750
```

---

## Implementation Checklist

- [ ] Read full audit (PATH_TRAVERSAL_AUDIT.md)
- [ ] Review code to fix (UPLOAD_TS_FIXED.ts)
- [ ] Apply upload.ts changes
- [ ] Add chmod to Dockerfile
- [ ] Run tests
- [ ] Commit with message: "security: add symlink detection & URL normalization"
- [ ] Merge to main

---

## Questions?

**Q: How critical is this?**
A: Medium. Requires OS compromise to exploit, but impact is high (file deletion).

**Q: Can users exploit this via the web API?**
A: No. filenames come from multer (UUID), imageUrl from database (server-controlled).

**Q: What if I don't fix this?**
A: If the server's filesystem is compromised (different risk), attackers could use symlinks for lateral movement.

**Q: Why not use realpath() for everything?**
A: Would work, but slower. fs.lstat() check is sufficient + simpler.

**Q: Do I need to roll back and retest?**
A: No breaking changes. Fixes are purely additive (new safety checks).

---

**Last Updated**: 2026-07-21  
**Audit By**: Claude Code Security Audit  
**Status**: Ready for Implementation
