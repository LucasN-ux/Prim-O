# Fixes Recommandées - Path Traversal Security

## Fix 1: Ajouter la Détection de Symlinks dans `removeUploadedFile()`

**Fichier**: `/home/mateo/prim-o/backend/src/lib/upload.ts`

**Code actuel (lignes 42-47)**:
```typescript
export async function removeUploadedFile(imageUrl: string): Promise<void> {
  const rel = imageUrl.replace(/^\/uploads\//, '');
  const abs = path.join(UPLOADS_DIR, rel);
  if (abs !== UPLOADS_DIR && !abs.startsWith(UPLOADS_DIR + path.sep)) return;
  await fs.unlink(abs).catch(() => { /* already gone */ });
}
```

**Code corrigé**:
```typescript
export async function removeUploadedFile(imageUrl: string): Promise<void> {
  const rel = imageUrl.replace(/^\/uploads\//, '');
  const abs = path.join(UPLOADS_DIR, rel);
  
  // Path traversal check
  if (abs !== UPLOADS_DIR && !abs.startsWith(UPLOADS_DIR + path.sep)) return;
  
  // Symlink detection - prevent traversal via symlinks
  try {
    const stats = await fs.lstat(abs);
    if (stats.isSymbolicLink()) {
      console.warn(`[SECURITY] Attempted symlink deletion blocked: ${abs}`);
      return; // Refuse to follow symlinks
    }
  } catch (err) {
    // File doesn't exist or lstat failed - that's fine, return silently
    return;
  }
  
  await fs.unlink(abs).catch(() => { /* already gone */ });
}
```

**Changements**:
1. Ajouter `fs.lstat()` qui NE suit pas les symlinks (contrairement à `fs.stat()`)
2. Vérifier `stats.isSymbolicLink()`
3. Logger et refuser la suppression si c'est un symlink
4. Wrapper en try-catch pour les erreurs (fichier non-existant)

**Pourquoi**:
- `stat()` suit les symlinks; `lstat()` les détecte
- Empêche la suppression de fichiers en dehors d'uploads via symlinks
- Sécurité-in-depth contre les attaques OS

---

## Fix 2: Normaliser les URLs Encodées

**Fichier**: `/home/mateo/prim-o/backend/src/lib/upload.ts`

**Ajouter en haut du fichier** (après les imports):
```typescript
import { fileURLToPath } from 'node:url';

// ... existing imports ...
```

**Mettre à jour `removeUploadedFile()`**:
```typescript
export async function removeUploadedFile(imageUrl: string): Promise<void> {
  // Normalize URL encoding to prevent double-encoding bypass
  const rel = decodeURIComponent(
    imageUrl.replace(/^\/uploads\//, '')
  );
  
  const abs = path.join(UPLOADS_DIR, rel);
  
  // Path traversal check
  if (abs !== UPLOADS_DIR && !abs.startsWith(UPLOADS_DIR + path.sep)) return;
  
  // Symlink detection
  try {
    const stats = await fs.lstat(abs);
    if (stats.isSymbolicLink()) {
      console.warn(`[SECURITY] Attempted symlink deletion blocked: ${abs}`);
      return;
    }
  } catch (err) {
    return;
  }
  
  await fs.unlink(abs).catch(() => { /* already gone */ });
}
```

**Changements**:
1. Ajouter `decodeURIComponent()` pour normaliser les URLs encodées
2. Prévient les bypass via double-encoding (`%252f`)

**Note**: Dans prim-o, `imageUrl` vient TOUJOURS de la DB (écrite par le serveur), donc ce fix est principalement de la sécurité-in-depth.

---

## Fix 3: Appliquer des Permissions Restrictives

**Fichier**: Ajouter au Dockerfile ou script de démarrage

**Option A - Dockerfile**:
```dockerfile
# Dans le Dockerfile du backend

RUN mkdir -p /app/backend/uploads/offers && \
    chmod 750 /app/backend/uploads && \
    chmod 750 /app/backend/uploads/offers
```

**Option B - Script d'initialisation** (après installation):
```bash
#!/bin/bash
# setup-uploads.sh

mkdir -p backend/uploads/offers
chmod 750 backend/uploads
chmod 750 backend/uploads/offers

echo "Upload directories secured with 750 permissions"
```

**Option C - package.json script**:
```json
{
  "scripts": {
    "postinstall": "mkdir -p backend/uploads/offers && chmod 750 backend/uploads backend/uploads/offers"
  }
}
```

**Pourquoi**:
- `750` signifie `rwxr-x---` (propriétaire: lecture/écriture/exécution, groupe: lecture/exécution, autres: rien)
- Réduit l'exposition si le serveur est compromis
- S'assure que seul le processus Node + son groupe peuvent accéder

---

## Fix 4 (Optionnel - Plus Robuste): Utiliser `realpath()`

**Fichier**: `/home/mateo/prim-o/backend/src/lib/upload.ts`

**Version plus sécurisée (résout tous les symlinks)**:
```typescript
export async function removeUploadedFile(imageUrl: string): Promise<void> {
  try {
    const rel = decodeURIComponent(
      imageUrl.replace(/^\/uploads\//, '')
    );
    
    const abs = path.join(UPLOADS_DIR, rel);
    
    // Basic path traversal check before realpath
    if (abs !== UPLOADS_DIR && !abs.startsWith(UPLOADS_DIR + path.sep)) {
      console.warn(`[SECURITY] Path traversal attempt blocked: ${abs}`);
      return;
    }
    
    // Resolve all symlinks and verify the real path
    const realPath = await fs.realpath(abs);
    const realUploadsDir = await fs.realpath(UPLOADS_DIR);
    
    if (!realPath.startsWith(realUploadsDir + path.sep)) {
      console.warn(`[SECURITY] Symlink traversal attempt blocked: ${abs} -> ${realPath}`);
      return;
    }
    
    await fs.unlink(realPath);
  } catch (err) {
    // File doesn't exist or permissions error - that's fine
  }
}
```

**Avantages**:
- Résout TOUS les symlinks, même imbriqués
- Plus défensif et robuste
- Validation après résolution

**Inconvénient**:
- Légèrement plus lent (I/O supplémentaire)
- Rejet valide des fichiers symlink (comportement strict)

---

## Priorités d'Application

### Critique (Appliquer Immédiatement):
1. **Fix 1** (Détection de symlinks) - Prévient l'attaque principal
2. **Fix 3** (Permissions 750) - Mitigation OS-level

### Recommandé (Appliquer Rapidement):
3. **Fix 2** (Normalisation URL) - Sécurité-in-depth

### Optionnel (Nice-to-have):
4. **Fix 4** (realpath()) - Si on veut l'approche ultra-sécurisée

---

## Ordre d'Application Suggéré

1. Appliquer Fix 1 + Fix 2 ensemble dans upload.ts
2. Appliquer Fix 3 dans le Dockerfile/script de démarrage
3. Tester avec curl/Postman

---

## Tests Après Fix

```bash
# Test 1: Vérifier que les uploads normaux fonctionnent encore
curl -X PATCH http://localhost:4000/api/admin/offers/{offerId}/image \
  -H "Authorization: Bearer {token}" \
  -F "image=@test.jpg"

# Test 2: Vérifier que la suppression normale fonctionne
curl -X DELETE http://localhost:4000/api/admin/offers/{offerId}/image \
  -H "Authorization: Bearer {token}"

# Test 3: Vérifier les permissions
ls -la backend/uploads/
# Doit montrer: drwxr-x--- (750)
```

---

## Références de Sécurité

- OWASP Path Traversal: https://owasp.org/www-community/attacks/Path_Traversal
- Node.js fs.lstat() vs fs.stat(): https://nodejs.org/docs/latest/api/fs.html
- CWE-22: Improper Limitation of a Pathname to a Restricted Directory: https://cwe.mitre.org/data/definitions/22.html
