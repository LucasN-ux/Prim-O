import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app, login, auth, createMember, topUpPool, type Member } from './helpers';

// Money can only be minted when two requests act on the same row at the same time, so these
// are the only tests that can catch it. Everything else in this suite sends one request at a
// time and would stay green while an envelope pays out five times over.
//
// Assertions are on DELTAS, never on absolute balances: these files share one seeded database
// and run in series, so whatever ran before must not be able to break them.
describe('Concurrence - un jeton ne doit jamais etre cree ni detruit', () => {
  let ownerToken: string;
  let adminToken: string;
  let motifId: string;
  let employeeA: Member;
  let employeeB: Member;

  const poolOf = async (): Promise<number> => {
    const res = await request(app).get('/api/company').set(auth(ownerToken));
    return res.body.company.tokenBalance;
  };

  const balanceOf = async (member: Member): Promise<number> => {
    const res = await request(app).get('/api/employees/me').set(auth(member.token));
    return res.body.employee?.balance ?? res.body.balance;
  };

  beforeAll(async () => {
    ownerToken = await login('boss@acme.fr');
    adminToken = await login('admin@primo.fr');

    const motifs = await request(app).get('/api/motifs').set(auth(ownerToken));
    motifId = motifs.body.categories[0].motifs[0].id;

    // De quoi financer les trois enveloppes de ce fichier, quoi qu'aient laisse les autres.
    await topUpPool(ownerToken, 1000);

    employeeA = await createMember(ownerToken, 'EMPLOYEE');
    employeeB = await createMember(ownerToken, 'EMPLOYEE');
  });

  it('cinq distributions simultanees de la meme enveloppe : une seule aboutit', async () => {
    const manager = await createMember(ownerToken, 'MANAGER');

    // Mode AUCUNE : la retribution vaut 0, donc le budget a repartir est le montant entier.
    const allocation = await request(app).post('/api/attributions/allocate')
      .set(auth(ownerToken)).send({ managerId: manager.id, amount: 100, mode: 'AUCUNE' });
    expect(allocation.status).toBe(201);

    const before = {
      a: await balanceOf(employeeA),
      b: await balanceOf(employeeB),
    };

    const lines = [
      { employeeId: employeeA.id, amount: 50, motifId },
      { employeeId: employeeB.id, amount: 50, motifId },
    ];
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        request(app).post('/api/attributions/distribute')
          .set(auth(manager.token))
          .send({ allocationId: allocation.body.allocationId, lines }),
      ),
    );

    const accepted = attempts.filter(
      (a) => a.status === 'fulfilled' && a.value.status === 201,
    ).length;
    expect(accepted).toBe(1);

    // Le coeur du test : les employes ont recu le montant de l'enveloppe, pas cinq fois.
    const distributed =
      (await balanceOf(employeeA)) - before.a + (await balanceOf(employeeB)) - before.b;
    expect(distributed).toBe(100);
  });

  it('distribuer pendant que le compte du manager est supprime ne cree ni ne detruit de jeton', async () => {
    const manager = await createMember(ownerToken, 'MANAGER');

    const allocation = await request(app).post('/api/attributions/allocate')
      .set(auth(ownerToken)).send({ managerId: manager.id, amount: 200, mode: 'AUCUNE' });
    expect(allocation.status).toBe(201);

    const before = {
      pool: await poolOf(),
      a: await balanceOf(employeeA),
      b: await balanceOf(employeeB),
    };

    // Le manager valide sa repartition au moment ou un administrateur supprime son compte.
    // La suppression rembourse l'enveloppe au pool, la distribution la verse aux employes :
    // l'une des deux doit gagner, jamais les deux.
    await Promise.allSettled([
      request(app).post('/api/attributions/distribute')
        .set(auth(manager.token))
        .send({
          allocationId: allocation.body.allocationId,
          lines: [
            { employeeId: employeeA.id, amount: 100, motifId },
            { employeeId: employeeB.id, amount: 100, motifId },
          ],
        }),
      request(app).delete(`/api/admin/users/${manager.id}`).set(auth(adminToken)),
    ]);

    const moved =
      (await poolOf()) - before.pool +
      ((await balanceOf(employeeA)) - before.a) +
      ((await balanceOf(employeeB)) - before.b);

    // 200 remis au pool OU 200 verses aux employes. 400 signifierait que les deux chemins
    // ont abouti, 0 que l'enveloppe s'est evaporee.
    expect(moved).toBe(200);
  });

  it("l'enveloppe finit dans un seul etat, jamais entre deux", async () => {
    const manager = await createMember(ownerToken, 'MANAGER');

    const allocation = await request(app).post('/api/attributions/allocate')
      .set(auth(ownerToken)).send({ managerId: manager.id, amount: 60, mode: 'AUCUNE' });
    const allocationId = allocation.body.allocationId;

    await Promise.allSettled([
      request(app).post('/api/attributions/distribute')
        .set(auth(manager.token))
        .send({ allocationId, lines: [{ employeeId: employeeA.id, amount: 60, motifId }] }),
      request(app).delete(`/api/admin/users/${manager.id}`).set(auth(adminToken)),
    ]);

    const sent = await request(app).get('/api/attributions/sent-envelopes').set(auth(ownerToken));
    const envelope = sent.body.envelopes.find(
      (e: { allocationId?: string; id?: string }) =>
        e.allocationId === allocationId || e.id === allocationId,
    );
    expect(envelope).toBeTruthy();
    expect(['DISTRIBUEE', 'ANNULEE']).toContain(envelope.status);
  });
});
