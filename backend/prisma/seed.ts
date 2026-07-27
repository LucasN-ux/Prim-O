import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

// Bcrypt cost per CLAUDE.md (>= 12).
const hash = (pwd: string) => bcrypt.hash(pwd, 12)

async function main() {
  console.log('Seeding database...')

  // Wipe tables in FK-safe order.
  await prisma.redemption.deleteMany()
  await prisma.attribution.deleteMany()
  await prisma.allocation.deleteMany()
  await prisma.motif.deleteMany()
  await prisma.companyTokenPurchase.deleteMany()
  await prisma.companyInviteCode.deleteMany()
  await prisma.promoCode.deleteMany()
  await prisma.partnerOffer.deleteMany()
  await prisma.category.deleteMany()
  await prisma.emailVerificationToken.deleteMany()
  await prisma.refreshToken.deleteMany()
  await prisma.user.deleteMany()
  await prisma.company.deleteMany()

  const categoryDefs = [
    { slug: 'food',     label: 'Restauration', icon: 'coffee', color: '#e5784a', sortOrder: 0 },
    { slug: 'shopping', label: 'Shopping',     icon: 'gift',   color: '#7c5cbf', sortOrder: 1 },
    { slug: 'culture',  label: 'Culture',      icon: 'ticket', color: '#2376ae', sortOrder: 2 },
    { slug: 'travel',   label: 'Voyage',       icon: 'plane',  color: '#1a9c5b', sortOrder: 3 },
    { slug: 'wellness', label: 'Bien-être',    icon: 'heart',  color: '#d64f6e', sortOrder: 4 },
    { slug: 'other',    label: 'Autre',        icon: 'gift',   color: '#00a19a', sortOrder: 5 },
  ]

  for (const cat of categoryDefs) {
    await prisma.category.upsert({
      where: { slug: cat.slug },
      update: cat,
      create: cat,
    })
  }

  const admin = await prisma.user.create({
    data: {
      email: 'admin@primo.fr',
      passwordHash: await hash('password123'),
      role: 'ADMIN',
      isEmailVerified: true,
      // companyId stays null: the ADMIN is the only user without a company.
    },
  })

  // Companies start with an empty pool; the admin credits it just below.
  const acme = await prisma.company.create({ data: { name: 'Acme', status: 'APPROVED' } })
  const testco = await prisma.company.create({ data: { name: 'TestCo', status: 'APPROVED' } })

  // The pool is only ever funded through the D2 purchase ledger: CompanyTokenPurchase + increment.
  await prisma.$transaction([
    prisma.companyTokenPurchase.create({
      data: { amount: 100, note: 'Crédit initial', companyId: acme.id, createdById: admin.id },
    }),
    prisma.company.update({ where: { id: acme.id }, data: { tokenBalance: { increment: 100 } } }),
    prisma.companyTokenPurchase.create({
      data: { amount: 100, note: 'Crédit initial', companyId: testco.id, createdById: admin.id },
    }),
    prisma.company.update({ where: { id: testco.id }, data: { tokenBalance: { increment: 100 } } }),
  ])

  // Owners carry no token balance of their own; the pool lives on Company.tokenBalance.
  const bossAcme = await prisma.user.create({
    data: {
      email: 'boss@acme.fr',
      passwordHash: await hash('password123'),
      role: 'OWNER',
      firstName: 'Boss',
      lastName: 'Acme',
      isEmailVerified: true,
      companyId: acme.id,
    },
  })

  await prisma.user.create({
    data: {
      email: 'test@testco.fr',
      passwordHash: await hash('password123'),
      role: 'OWNER',
      firstName: 'Test',
      lastName: 'Co',
      isEmailVerified: true,
      companyId: testco.id,
    },
  })

  const managerAcme = await prisma.user.create({
    data: {
      email: 'manager@acme.fr',
      passwordHash: await hash('password123'),
      role: 'MANAGER',
      firstName: 'Luc',
      lastName: 'Acme',
      isEmailVerified: true,
      companyId: acme.id,
    },
  })

  const managerTestCo = await prisma.user.create({
    data: {
      email: 'manager@testco.fr',
      passwordHash: await hash('password123'),
      role: 'MANAGER',
      firstName: 'Kilian',
      lastName: 'TestCo',
      isEmailVerified: true,
      companyId: testco.id,
    },
  })

  const jean = await prisma.user.create({
    data: {
      email: 'jean.dupont@acme.fr',
      passwordHash: await hash('password123'),
      role: 'EMPLOYEE',
      firstName: 'Jean',
      lastName: 'Dupont',
      isEmailVerified: true,
      companyId: acme.id,
    },
  })

  const marie = await prisma.user.create({
    data: {
      email: 'marie.martin@acme.fr',
      passwordHash: await hash('password123'),
      role: 'EMPLOYEE',
      firstName: 'Marie',
      lastName: 'Martin',
      isEmailVerified: true,
      companyId: acme.id,
    },
  })

  // Official v1.1 motifs (§3.5): 13 motifs across 4 categories. The list is frozen and
  // ADMIN-managed (employer-defined motifs come in V2).
  await prisma.motif.createMany({
    data: [
      { tag: 'PONCTUALITE_PRESENCE', label: 'Ponctualité & présence', category: 'COMPORTEMENTS_INDIVIDUELS', compliment: "Toujours là, toujours à l'heure", sortOrder: 1 },
      { tag: 'PRISE_INITIATIVE', label: "Prise d'initiative", category: 'COMPORTEMENTS_INDIVIDUELS', compliment: "Tu n'as pas attendu qu'on te le demande", sortOrder: 2 },
      { tag: 'QUALITE_EXECUTION', label: "Qualité d'exécution", category: 'COMPORTEMENTS_INDIVIDUELS', compliment: "C'est fait, et c'est bien fait", sortOrder: 3 },
      { tag: 'AUTONOMIE', label: 'Autonomie', category: 'COMPORTEMENTS_INDIVIDUELS', compliment: 'Tu gères, et ça se voit', sortOrder: 4 },
      { tag: 'ATTITUDE_ACCUEIL_CLIENT', label: 'Attitude & accueil client', category: 'RELATION_CLIENT', compliment: "Tu as mis le client à l'aise dès le premier regard", sortOrder: 5 },
      { tag: 'GESTION_SITUATION_DIFFICILE', label: 'Gestion situation difficile', category: 'RELATION_CLIENT', compliment: 'Tu as géré avec calme et professionnalisme', sortOrder: 6 },
      { tag: 'FIDELISATION_CLIENT', label: 'Fidélisation client', category: 'RELATION_CLIENT', compliment: 'Ce client reviendra grâce à toi', sortOrder: 7 },
      { tag: 'VENTE_ADDITIONNELLE', label: 'Vente additionnelle', category: 'RELATION_CLIENT', compliment: 'Tu as su proposer au bon moment', sortOrder: 8 },
      { tag: 'ENTRAIDE_COOPERATION', label: 'Entraide & coopération', category: 'ESPRIT_COLLECTIF', compliment: "Tu as tiré l'équipe vers le haut", sortOrder: 9 },
      { tag: 'TRANSMISSION_COMPETENCES', label: 'Transmission de compétences', category: 'ESPRIT_COLLECTIF', compliment: "Tu as pris le temps d'expliquer - c'est rare", sortOrder: 10 },
      { tag: 'POLYVALENCE_ACCEPTEE', label: 'Polyvalence acceptée', category: 'ESPRIT_COLLECTIF', compliment: "Tu as dit oui quand on avait besoin", sortOrder: 11 },
      { tag: 'PRESENCE_SITUATION_TENDUE', label: 'Présence en situation tendue', category: 'ENGAGEMENT', compliment: "Tu étais là quand c'était difficile", sortOrder: 12 },
      { tag: 'RESPECT_PROCESS_HYGIENE', label: 'Respect des process & hygiène', category: 'ENGAGEMENT', compliment: 'Rien ne traîne, tout est carré', sortOrder: 13 },
    ],
  })
  const motifQualite = await prisma.motif.findUniqueOrThrow({ where: { tag: 'QUALITE_EXECUTION' } })
  const motifVente = await prisma.motif.findUniqueOrThrow({ where: { tag: 'VENTE_ADDITIONNELLE' } })

  // Attributions debit the company pool and credit the employees in one transaction (ledger invariant).
  // jean +30, marie +50, so the Acme pool ends at 100 - 80 = 20.
  await prisma.$transaction([
    prisma.attribution.create({
      data: {
        amount: 30,
        motifId: motifQualite.id,
        companyId: acme.id,
        managerId: bossAcme.id,
        employeeId: jean.id,
      },
    }),
    prisma.attribution.create({
      data: {
        amount: 50,
        motifId: motifVente.id,
        companyId: acme.id,
        managerId: bossAcme.id,
        employeeId: marie.id,
      },
    }),
    prisma.user.update({ where: { id: jean.id }, data: { balance: { increment: 30 } } }),
    prisma.user.update({ where: { id: marie.id }, data: { balance: { increment: 50 } } }),
    prisma.company.update({ where: { id: acme.id }, data: { tokenBalance: { decrement: 80 } } }),
  ])

  // Each offer references a Category row by id, resolved from the categories seeded above.
  const cats = await prisma.category.findMany({ select: { id: true, slug: true } })
  const catId = new Map(cats.map((c) => [c.slug, c.id]))
  const need = (slug: string): string => {
    const id = catId.get(slug)
    if (!id) throw new Error(`Catégorie manquante au seed : ${slug}`)
    return id
  }

  // Royalty-free thematic photos (Unsplash, no-attribution license), cropped square to fit the
  // catalogue card frame.
  const u = (id: string) => `https://images.unsplash.com/photo-${id}?w=800&h=800&fit=crop&q=80`
  const IMG = {
    amazon: u('1556742049-0cfed4f6a45d'),   // Parcel / e-commerce.
    netflix: u('1574375927938-d5a98e8ffe85'), // Cinema / popcorn.
    uberEats: u('1568901346375-23c9450c58cd'), // Burger / meal.
    spotify: u('1511671782779-c97d3d27a1d4'),  // Headphones / music.
    decathlon: u('1538805060514-97d9cc17730c'), // Running / sport.
    sncf: u('1474487548417-781cb71495f3'),     // Train / travel.
  }

  const amazon = await prisma.partnerOffer.create({
    data: { partnerName: 'Amazon', cost: 20, discountPercent: 50, categoryId: need('shopping'), isActive: true, imageUrl: IMG.amazon },
  })

  const netflix = await prisma.partnerOffer.create({
    data: { partnerName: 'Netflix', cost: 15, discountPercent: 30, categoryId: need('culture'), isActive: true, imageUrl: IMG.netflix },
  })

  // Extra offers to flesh out the catalogue.
  await prisma.partnerOffer.createMany({
    data: [
      { partnerName: 'Uber Eats', cost: 12, discountPercent: 25, categoryId: need('food'), isActive: true, imageUrl: IMG.uberEats },
      { partnerName: 'Spotify', cost: 10, discountPercent: 40, categoryId: need('culture'), isActive: true, imageUrl: IMG.spotify },
      { partnerName: 'Decathlon', cost: 18, discountPercent: 20, categoryId: need('wellness'), isActive: true, imageUrl: IMG.decathlon },
      { partnerName: 'SNCF Connect', cost: 25, discountPercent: 15, categoryId: need('travel'), isActive: true, imageUrl: IMG.sncf },
    ],
  })

  await prisma.promoCode.createMany({
    data: [
      { code: 'AMAZON-SEED-001', offerId: amazon.id },
      { code: 'AMAZON-SEED-002', offerId: amazon.id },
      { code: 'NETFLIX-SEED-001', offerId: netflix.id },
    ],
  })

  console.log('✅ Seed terminé.')
  console.log('   Admin     : admin@primo.fr')
  // Acme: 100 credited, 80 handed out to jean and marie, so 20 left in the pool.
  console.log('   Companies : Acme (pool 20), TestCo (pool 100)')
  console.log('   Owners    : boss@acme.fr, test@testco.fr')
  console.log('   Employees : jean.dupont@acme.fr (30), marie.martin@acme.fr (50)')
  console.log('   Offers    : Amazon (SHOPPING), Netflix (CULTURE)')
  console.log('   Codes     : AMAZON-SEED-001, AMAZON-SEED-002, NETFLIX-SEED-001')
  console.log('   Password  : password123 (tous)')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
