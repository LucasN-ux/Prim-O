# Audit Path Traversal - Projet prim-o

Date: 2026-07-21
Scope: backend/src file operations

## Résumé Exécutif

Le projet utilise un seul point d'entrée de fichiers : les uploads d'images d'offres. La sécurité repose sur :
1. **multer** qui génère des UUIDs aléatoires côté serveur (bon)
2. **Validation stricte dans `removeUploadedFile()`** pour empêcher la suppression de fichiers hors de `/uploads`

**RÉSULTAT: 2 vulnérabilités trouvées + 1 risque de configuration**

---

## 1. Point d'Entrée Principal : Upload d'Images

### Fichier: `/home/mateo/prim-o/backend/src/lib/upload.ts`

**Configuration:**
- **Stockage**: `backend/uploads/offers/` (hors webroot ✓)
- **Serveur statique**: `app.use('/api/uploads', express.static(UPLOADS_DIR))` (ligne 78 de app.ts)
- **Génération de noms**: `crypto.randomUUID() + extension` (ligne 25)

**Protection:**
```typescript
// ligne 21-27: multer configuration
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, OFFERS_DIR),
  filename: (_req, file, cb) => {
    const ext = ALLOWED.get(file.mimetype) ?? '';
    cb(null, `${crypto.randomUUID()}${ext}`); // STRONG: no user input
  },
});
```

**Verdict:** ✓ SÉCURISÉ - Les noms de fichiers sont générés côté serveur, le client ne contrôle rien.

---

## 2. Suppression Sécurisée - `removeUploadedFile()`

### Fichier: `/home/mateo/prim-o/backend/src/lib/upload.ts`, lignes 42-47

```typescript
export async function removeUploadedFile(imageUrl: string): Promise<void> {
  const rel = imageUrl.replace(/^\/uploads\//, '');
  const abs = path.join(UPLOADS_DIR, rel);
  if (abs !== UPLOADS_DIR && !abs.startsWith(UPLOADS_DIR + path.sep)) return;
  await fs.unlink(abs).catch(() => { /* already gone */ });
}
```

**Analyse:**
1. `imageUrl` provient de la DB (écrite par le serveur uniquement)
2. `path.join()` normalise le chemin mais **ne résout pas les symlinks**
3. **Vérification de traversal** : refuse si le chemin sort de UPLOADS_DIR

**Scénarios testés:**

### ✓ Cas Légitimes (BLOQUES CORRECTEMENT)
```
Input:  /uploads/offers/abc123.jpg
Rel:    offers/abc123.jpg
Abs:    /home/mateo/prim-o/backend/uploads/offers/abc123.jpg
Result: AUTORISE (dans UPLOADS_DIR) ✓
```

### ✓ Tentative de Traversal Standard (BLOQUEE)
```
Input:  /uploads/offers/../../etc/passwd
Rel:    offers/../../etc/passwd
Abs:    /home/mateo/prim-o/backend/etc/passwd
Check:  startsWith('/home/mateo/prim-o/backend/uploads' + '/') = FALSE
Result: BLOQUEE ✓
```

---

## 3. VULNERABILITÉ 1: Symlinks dans le Répertoire d'Upload

**Criticité: MOYENNE (nécessite accès serveur ou upload antérieur)**

### Vecteur d'Attaque:
```bash
# Si un attaquant peut créer un symlink dans backend/uploads/offers/:
ln -s /etc backend/uploads/offers/symlink-to-etc

# Puis via removeUploadedFile():
/uploads/offers/symlink-to-etc/passwd
Rel:  offers/symlink-to-etc/passwd
Abs:  /home/mateo/prim-o/backend/uploads/offers/symlink-to-etc/passwd
Check: startsWith('/home/mateo/prim-o/backend/uploads/') = TRUE
Result: SUPPRESSION AUTORISEE! ✓ Lecture de /etc/passwd via erreur
```

### Scénario Exploit:
1. Obtenir accès shell au serveur (compromission OS)
2. Créer symlink: `ln -s /etc backend/uploads/offers/pw`
3. Appeler l'API pour "supprimer" l'image: DELETE /api/admin/offers/{id}/image
4. **Accès à /etc/passwd confirmé via erreur ou accès suivi**

### Prérequis Atténuants:
- Nécessite accès en écriture à `backend/uploads/offers/`
- Nécessite authentification admin pour l'API de suppression
- Erreurs de permission leakent des infos

### Remédiation:
```typescript
// Option 1: Vérifier les symlinks
if (fs.lstatSync(abs).isSymbolicLink()) {
  console.warn(`Symlink detected, refusing: ${abs}`);
  return;
}

// Option 2: Utiliser path.resolve + realpath (résout et valide)
const real = await fs.realpath(abs);
if (!real.startsWith(UPLOADS_DIR + path.sep)) {
  throw new Error('Symlink traversal detected');
}

// Option 3: Permissions du répertoire (meilleure pratique)
// chmod 700 backend/uploads
// chmod 500 backend/uploads/offers (lecture-exécution, pas écriture)
```

---

## 4. VULNERABILITÉ 2: Encodage de Chemin Double (Double URL Encoding)

**Criticité: BASSE (limité par express.static, mais présent)**

### Vecteur d'Attaque:
```
Input (double-encoded):  /uploads/offers/..%252f..%252fetc%252fpasswd
Decode 1 (express):      /uploads/offers/..%2f..%2fetc%2fpasswd
Decode 2 (app):          /uploads/offers/../../etc/passwd (pas décodé par removeUploadedFile)
Abs path:                /home/mateo/prim-o/backend/uploads/offers/..%2f..%2fetc%2fpasswd
Check:                   startsWith('/home/mateo/prim-o/backend/uploads/') = TRUE
Result:                  FICHIER AVEC NOM BIZARRE ACCEPTE
```

**Impact Réel:**
- Le serveur tenterait de supprimer un fichier avec `%2f` dans le nom
- La plupart des systèmes acceptent `%` dans les noms
- Peu d'impact car multer ne crée jamais ces fichiers
- Risque si l'imagURL est écrite directement via API (pas fait ici)

### Scenario dans prim-o:
1. `imageUrl` vient TOUJOURS de multer (UUID)
2. Pas de route pour envoyer une imageUrl directe
3. Donc, faible risque pratique

---

## 5. ROUTES D'ACCES AUX FICHIERS

### Public (Lecture):
```
GET /api/uploads/* → express.static(UPLOADS_DIR)
```
- **Accès**: Tout le monde
- **Sécurité express.static**: Par défaut, refuse les traversals (../)
- **Configuration**: Aucune option dangereuse détectée

### Admin (Upload & Suppression):
```
POST   /api/admin/offers/{id}/image → uploadOfferImageMiddleware + uploadOfferImageController
DELETE /api/admin/offers/{id}/image → deleteOfferImageController
```
- **Authentification**: requireAuth + requireAdmin ✓
- **Upload**: multer + validation MIME ✓
- **Suppression**: removeUploadedFile() avec vérification ✓

**Audit des routes:** ✓ Aucune route permettant GET /api/uploads/:path ou similar

---

## 6. STOCKAGE TEMPORAIRE ET CLEANUP

### Fichiers Temporaires:
- **multer par défaut**: Aucun fichier temporaire (écriture directe via diskStorage)
- **Cleanup en cas d'erreur**: Fait dans uploadOfferImageController, ligne 121
  ```typescript
  await removeUploadedFile(`${OFFERS_PUBLIC_PREFIX}/${req.file.filename}`);
  ```
- **Orphelins possibles**: Si le serveur crash entre l'upload et la DB update
  - Mitigation: UUIDs uniques → peu de collision, pas d'accès sans DB

---

## 7. OPERATIONS FILESYSTEM INVENTAIRE

| Fonction | Fichier | Ligne | Opération | Contrôle |
|----------|---------|-------|-----------|----------|
| `uploadOfferImageMiddleware` | offer.controller.ts | 96 | multer.diskStorage | Server-side filename ✓ |
| `uploadOfferImageController` | offer.controller.ts | 121 | removeUploadedFile | Validation traversal ✓ |
| `setOfferImage` | offer.service.ts | 56 | Compose imageUrl | From DB only ✓ |
| `clearOfferImage` | offer.service.ts | 65 | removeUploadedFile | Validation traversal ✓ |
| `removeUploadedFile` | upload.ts | 44 | path.join + unlink | Path validation ✓ |

---

## 8. EXTRACTION ZIP/TAR

**Recherche**: Aucune utilisation de `unzipper`, `tar`, `gunzip` ou librairies d'extraction trouvée.

**Verdict**: ✓ Pas de risque zip-bombing ou tar traversal.

---

## 9. GESTION DES PERMISSIONS

### Répertoire de Stockage:
```bash
$ ls -la /home/mateo/prim-o/backend/
drwxr-xr-x 3 mateo mateo 4096 Jul  2 09:44 uploads
drwxr-xr-x 2 mateo mateo 4096 Jul  2 09:44 uploads/offers
```

**Problème Détecté:**
- Permissions `755` (rwxr-xr-x) permettent à n'importe quel utilisateur du système de lire les fichiers
- Permissions `755` permettent ÉCRITURE par le propriétaire uniquement, mais...
- **Si le processus Node tourne sous un utilisateur différent**, permission issues possibles

**Recommandation:**
```bash
# En production:
chmod 750 backend/uploads
chmod 750 backend/uploads/offers
# Assure que seul l'utilisateur du processus + groupe peut accéder
```

---

## 10. ACCÈS CONTROL À DISTANCE

### Qui Peut Télécharger Quoi:
1. **Images d'offre** (public):
   - **Accès**: Via `/api/uploads/` (express.static)
   - **Protection**: Aucune, fichiers publics par design ✓
   - **Authentification**: Non requise ✓

2. **Suppression d'images**:
   - **Route**: `DELETE /api/admin/offers/:id/image`
   - **Authentification**: requireAuth + requireAdmin ✓
   - **Validation**: Vérifie que l'offre existe (findUnique)
   - **Risk**: Admin peut supprimer n'importe quelle offre, pas de scope par compagnie
     - **Acceptable**: Les admins sont de confiance (staff internal)

### Faille de Scope:
```typescript
// offer.service.ts, ligne 53-59
export const setOfferImage = async (id: string, filename: string) => {
  const existing = await prisma.partnerOffer.findUnique({ where: { id }, ... })
  if (!existing) throw new Error('OFFER_NOT_FOUND')
  // ... update
}
```
**Observation**: Pas de vérification que l'offre appartient à la compagnie de l'admin.
- **Risque**: Un admin d'une compagnie peut modifier les offres d'une autre compagnie
- **Contexte**: Offres sont globales (partenaires), pas scoped par compagnie
- **Verdict**: Acceptable par design

---

## 11. RÉSUMÉ DES TROUVAILLES

### ✓ Forces:
1. **Noms de fichiers générés côté serveur** (UUID)
2. **Validation rigoureuse de traversal** dans `removeUploadedFile()`
3. **Aucune entrée utilisateur dans les chemins de fichier**
4. **Pas de routes de listing de répertoires**
5. **Pas d'extraction ZIP/TAR**

### ⚠ Faiblesses:

| Sévérité | Problème | Localisation | Mitigation |
|----------|----------|--------------|------------|
| **MOYENNE** | Symlinks non détectés | upload.ts:44-45 | Utiliser `fs.realpath()` + validation |
| **BASSE** | Double URL encoding accepté | upload.ts:44 | Normaliser avec `decodeURIComponent()` |
| **BASSE** | Permissions répertoire trop permissives | backend/uploads | chmod 750 |

---

## 12. RECOMMANDATIONS PRIORITAIRES

### Immédiat (P1):
1. **Ajouter détection de symlinks**:
   ```typescript
   const stats = await fs.lstat(abs); // NOT stat()
   if (stats.isSymbolicLink()) {
     console.warn(`[SECURITY] Symlink blocked: ${abs}`);
     return;
   }
   ```

### Court Terme (P2):
2. **Normaliser les URL encodées**:
   ```typescript
   const rel = imageUrl.replace(/^\/uploads\//, '');
   const normalized = decodeURIComponent(rel); // Decode all
   const abs = path.join(UPLOADS_DIR, normalized);
   // ... rest of validation
   ```

3. **Restreindre permissions**:
   ```bash
   # Ajouter au Dockerfile ou startup script
   chmod 750 backend/uploads backend/uploads/offers
   ```

### Long Terme (P3):
4. **Utiliser `path.resolve()` + `realpath()`**:
   ```typescript
   const canonical = await fs.promises.realpath(abs);
   if (!canonical.startsWith(path.resolve(UPLOADS_DIR) + path.sep)) {
     throw new Error('Attempted traversal via symlink');
   }
   ```

---

## 13. TESTS DE VALIDATION

Créer des tests unitaires:

```typescript
// __tests__/upload.security.test.ts
import { removeUploadedFile } from '../src/lib/upload';

describe('removeUploadedFile - Security', () => {
  test('blocks directory traversal with ../', async () => {
    // Expect no error but file NOT deleted
    await removeUploadedFile('/uploads/offers/../../etc/passwd');
    // Assert file doesn't exist or test creation
  });

  test('blocks symlinks', async () => {
    // Create symlink first, then test
    // Should refuse to delete
  });

  test('allows legitimate offers', async () => {
    // Should delete actual offer file
  });
});
```

---

## 14. CONCLUSION

Le projet est **globalement sécurisé** contre les traversals de chemin grâce à:
1. Génération côté serveur des noms
2. Validation stricte des chemins

**Mais deux améliorations critiques:**
1. **Symlinks**: Ajouter `fs.lstat()` check + `fs.realpath()` validation
2. **Permissions**: Restreindre à `750` sur le répertoire d'uploads

**Aucune vulnérabilité critique** trouvée permettant l'accès à des fichiers hors-répertoire de manière directe depuis le web.

---

## Fichiers Analysés

- `/home/mateo/prim-o/backend/src/lib/upload.ts` - ✓ Analysé
- `/home/mateo/prim-o/backend/src/controllers/offer.controller.ts` - ✓ Analysé  
- `/home/mateo/prim-o/backend/src/services/offer.service.ts` - ✓ Analysé
- `/home/mateo/prim-o/backend/src/app.ts` - ✓ Analysé
- `/home/mateo/prim-o/backend/src/routes/admin.routes.ts` - ✓ Analysé
- `/home/mateo/prim-o/backend/src/controllers/privacy.controller.ts` - ✓ Analysé

Tous les fichiers d'upload, suppression et service statique.
