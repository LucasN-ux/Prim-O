import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app, login, auth, createMember } from './helpers';

// An access token freezes role and companyId for fifteen minutes. Every test in this file
// replays a token that is still cryptographically valid after the account behind it changed,
// which is the only way to catch a revocation that never takes effect.
//
// Before the fix, a dismissed owner used that window to mint an invite code valid for
// twenty-four hours and walked straight back into the company.
describe('Revocation - la base decide, pas le jeton', () => {
  let ownerToken: string;
  let adminToken: string;

  beforeAll(async () => {
    ownerToken = await login('boss@acme.fr');
    adminToken = await login('admin@primo.fr');
  });

  it('un compte supprime ne peut plus rien faire, meme avec son jeton encore valide', async () => {
    const manager = await createMember(ownerToken, 'MANAGER');

    // Le compte est actif : tout fonctionne.
    expect((await request(app).get('/api/auth/me').set(auth(manager.token))).status).toBe(200);

    const del = await request(app).delete(`/api/admin/users/${manager.id}`).set(auth(adminToken));
    expect(del.status).toBe(200);

    // Le meme jeton, non expire, ne signe plus rien.
    expect((await request(app).get('/api/auth/me').set(auth(manager.token))).status).toBe(401);
    expect(
      (await request(app).get('/api/employees/list').set(auth(manager.token))).status,
    ).toBe(401);
  });

  it("un compte supprime ne peut plus fabriquer de code d'invitation", async () => {
    const manager = await createMember(ownerToken, 'MANAGER');

    // Avant suppression, il en a le droit.
    const before = await request(app).post('/api/invites/generate')
      .set(auth(manager.token)).send({ role: 'EMPLOYEE', maxUses: 1, expiresInHours: 1 });
    expect(before.status).toBe(201);

    await request(app).delete(`/api/admin/users/${manager.id}`).set(auth(adminToken));

    // C'est le coeur du probleme : un code vit vingt-quatre heures, bien plus longtemps que
    // le jeton qui l'a produit. Le laisser passer, c'est laisser rentrer quelqu'un qu'on
    // vient de mettre dehors.
    const after = await request(app).post('/api/invites/generate')
      .set(auth(manager.token)).send({ role: 'EMPLOYEE', maxUses: 100, expiresInHours: 24 });
    expect(after.status).toBe(401);
  });

  it('une retrogradation prend effet immediatement, sans attendre l expiration du jeton', async () => {
    const manager = await createMember(ownerToken, 'MANAGER');

    const before = await request(app).post('/api/invites/generate')
      .set(auth(manager.token)).send({ role: 'EMPLOYEE', maxUses: 1, expiresInHours: 1 });
    expect(before.status).toBe(201);

    const demote = await request(app).patch(`/api/admin/users/${manager.id}`)
      .set(auth(adminToken)).send({ role: 'EMPLOYEE' });
    expect(demote.status).toBe(200);

    // Le jeton annonce toujours MANAGER. La base dit EMPLOYEE, et c'est elle qui tranche.
    const after = await request(app).post('/api/invites/generate')
      .set(auth(manager.token)).send({ role: 'EMPLOYEE', maxUses: 1, expiresInHours: 1 });
    expect(after.status).toBe(403);
  });

  it('un jeton dont le sujet est absurde repond 401, pas 500', async () => {
    // Prisma refuse un identifiant qui n'est pas un UUID. C'est un mauvais jeton, pas une
    // panne serveur : la reponse doit rester 401.
    const res = await request(app).get('/api/auth/me').set(auth('pas-un-jeton'));
    expect(res.status).toBe(401);
  });
});
