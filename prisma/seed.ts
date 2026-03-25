import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL as string }) })

const DEFAULT_CATEGORIES: { name: string; icon: string }[] = [
  { name: 'Housing',         icon: 'Home' },
  { name: 'Transport',       icon: 'Car' },
  { name: 'Utilities',       icon: 'Zap' },
  { name: 'Food & Groceries',icon: 'ShoppingCart' },
  { name: 'Insurance',       icon: 'Shield' },
  { name: 'Subscriptions',   icon: 'RefreshCw' },
  { name: 'Healthcare',      icon: 'Heart' },
  { name: 'Savings',         icon: 'PiggyBank' },
  { name: 'Other',           icon: 'Tag' },
]

async function main() {
  // ── Admin user ─────────────────────────────────────────────────────────────
  const email = process.env.ADMIN_EMAIL ?? 'admin@budgeteer.local'
  const password = process.env.ADMIN_PASSWORD ?? 'changeme123'
  const name = process.env.ADMIN_NAME ?? 'Admin'

  let admin = await prisma.user.findUnique({ where: { email } })
  if (admin) {
    console.log(`Admin user already exists (${email}), skipping user seed.`)
  } else {
    const passwordHash = await bcrypt.hash(password, 12)
    admin = await prisma.user.create({
      data: { email, name, passwordHash, role: 'SYSTEM_ADMIN', mustChangePassword: true },
    })
    await prisma.userPreferences.create({ data: { userId: admin.id } })
    console.log(`✓ Created admin user: ${admin.email}`)
    console.log(`  Default password: ${password}`)
    console.log(`  Change this on first login.`)
  }

  // ── Default system-wide categories (idempotent, with icons) ───────────────
  let seeded = 0
  for (const { name: categoryName, icon } of DEFAULT_CATEGORIES) {
    const existing = await prisma.expenseCategory.findFirst({
      where: { name: categoryName, isSystemWide: true },
    })
    if (!existing) {
      await prisma.expenseCategory.create({
        data: { name: categoryName, icon, isSystemWide: true, createdByUserId: admin.id },
      })
      seeded++
    } else if (existing.icon !== icon) {
      await prisma.expenseCategory.update({
        where: { id: existing.id },
        data: { icon },
      })
    }
  }
  if (seeded > 0) console.log(`✓ Seeded ${seeded} default expense categories.`)
  else console.log(`Default categories already exist, skipping.`)

  // ── Demo data (only when SEED_DEMO_DATA=true) ──────────────────────────────
  if (process.env.SEED_DEMO_DATA !== 'true') return

  const existingDemo = await prisma.user.findUnique({ where: { email: 'alice@demo.local' } })
  if (existingDemo) {
    console.log('Demo data already exists, skipping.')
    return
  }

  console.log('Seeding demo data…')

  const demoPassword = await bcrypt.hash('demo1234', 12)

  const [alice, bob, carol, dave] = await Promise.all([
    prisma.user.create({ data: { email: 'alice@demo.local', name: 'Alice Demo', passwordHash: demoPassword } }),
    prisma.user.create({ data: { email: 'bob@demo.local',   name: 'Bob Demo',   passwordHash: demoPassword } }),
    prisma.user.create({ data: { email: 'carol@demo.local', name: 'Carol Demo', passwordHash: demoPassword } }),
    prisma.user.create({ data: { email: 'dave@demo.local',  name: 'Dave Demo',  passwordHash: demoPassword } }),
  ])
  await Promise.all([
    prisma.userPreferences.create({ data: { userId: alice.id } }),
    prisma.userPreferences.create({ data: { userId: bob.id } }),
    prisma.userPreferences.create({ data: { userId: carol.id } }),
    prisma.userPreferences.create({ data: { userId: dave.id } }),
  ])
  console.log('✓ Created 4 demo users (password: demo1234)')

  const categories = await prisma.expenseCategory.findMany({ where: { isSystemWide: true } })
  const cat = (name: string) => categories.find((c) => c.name === name)!

  const currentYear = new Date().getFullYear()

  // ── Household 1: Smith Family ──────────────────────────────────────────────
  const smithHousehold = await prisma.household.create({
    data: {
      name: 'The Smith Family',
      members: {
        create: [
          { userId: alice.id, role: 'ADMIN' },
          { userId: bob.id,   role: 'MEMBER' },
        ],
      },
    },
  })

  // Smith: retired year (last year)
  const smithRetired = await prisma.budgetYear.create({
    data: { householdId: smithHousehold.id, year: currentYear - 1, status: 'RETIRED' },
  })
  await prisma.expense.createMany({
    data: [
      { budgetYearId: smithRetired.id, label: 'Rent',          amount: 1800, frequency: 'MONTHLY',  monthlyEquivalent: 1800,   categoryId: cat('Housing').id },
      { budgetYearId: smithRetired.id, label: 'Groceries',     amount: 600,  frequency: 'MONTHLY',  monthlyEquivalent: 600,    categoryId: cat('Food & Groceries').id },
      { budgetYearId: smithRetired.id, label: 'Car insurance', amount: 1200, frequency: 'ANNUAL',   monthlyEquivalent: 100,    categoryId: cat('Insurance').id },
      { budgetYearId: smithRetired.id, label: 'Electricity',   amount: 250,  frequency: 'MONTHLY',  monthlyEquivalent: 250,    categoryId: cat('Utilities').id },
      { budgetYearId: smithRetired.id, label: 'Netflix',       amount: 18,   frequency: 'MONTHLY',  monthlyEquivalent: 18,     categoryId: cat('Subscriptions').id },
    ],
  })
  await prisma.savingsEntry.createMany({
    data: [
      { budgetYearId: smithRetired.id, label: 'Emergency fund', amount: 300, frequency: 'MONTHLY', monthlyEquivalent: 300 },
    ],
  })

  // Smith: active year (current)
  const smithActive = await prisma.budgetYear.create({
    data: { householdId: smithHousehold.id, year: currentYear, status: 'ACTIVE' },
  })
  await prisma.expense.createMany({
    data: [
      { budgetYearId: smithActive.id, label: 'Rent',              amount: 1900, frequency: 'MONTHLY',      monthlyEquivalent: 1900,                 categoryId: cat('Housing').id },
      { budgetYearId: smithActive.id, label: 'Groceries',         amount: 650,  frequency: 'MONTHLY',      monthlyEquivalent: 650,                  categoryId: cat('Food & Groceries').id },
      { budgetYearId: smithActive.id, label: 'Car insurance',     amount: 1320, frequency: 'ANNUAL',       monthlyEquivalent: 110,                  categoryId: cat('Insurance').id },
      { budgetYearId: smithActive.id, label: 'Electricity',       amount: 270,  frequency: 'MONTHLY',      monthlyEquivalent: 270,                  categoryId: cat('Utilities').id },
      { budgetYearId: smithActive.id, label: 'Netflix',           amount: 18,   frequency: 'MONTHLY',      monthlyEquivalent: 18,                   categoryId: cat('Subscriptions').id },
      { budgetYearId: smithActive.id, label: 'Spotify',           amount: 12,   frequency: 'MONTHLY',      monthlyEquivalent: 12,                   categoryId: cat('Subscriptions').id },
      { budgetYearId: smithActive.id, label: 'Health check-ups',  amount: 600,  frequency: 'ANNUAL',       monthlyEquivalent: 50,                   categoryId: cat('Healthcare').id },
      { budgetYearId: smithActive.id, label: 'Car fuel',          amount: 80,   frequency: 'WEEKLY',       monthlyEquivalent: parseFloat((80 * 52 / 12).toFixed(2)), categoryId: cat('Transport').id },
    ],
  })
  await prisma.savingsEntry.createMany({
    data: [
      { budgetYearId: smithActive.id, label: 'Emergency fund', amount: 400, frequency: 'MONTHLY', monthlyEquivalent: 400 },
      { budgetYearId: smithActive.id, label: 'Holiday fund',   amount: 150, frequency: 'MONTHLY', monthlyEquivalent: 150 },
    ],
  })

  // Smith: simulation
  const smithSim = await prisma.budgetYear.create({
    data: {
      householdId: smithHousehold.id,
      year: currentYear,
      status: 'SIMULATION',
      simulationName: 'Buy a house scenario',
      copiedFromId: smithActive.id,
    },
  })
  await prisma.expense.createMany({
    data: [
      { budgetYearId: smithSim.id, label: 'Mortgage',          amount: 2200, frequency: 'MONTHLY', monthlyEquivalent: 2200, categoryId: cat('Housing').id },
      { budgetYearId: smithSim.id, label: 'Groceries',         amount: 650,  frequency: 'MONTHLY', monthlyEquivalent: 650,  categoryId: cat('Food & Groceries').id },
      { budgetYearId: smithSim.id, label: 'Car insurance',     amount: 1320, frequency: 'ANNUAL',  monthlyEquivalent: 110,  categoryId: cat('Insurance').id },
      { budgetYearId: smithSim.id, label: 'Electricity',       amount: 270,  frequency: 'MONTHLY', monthlyEquivalent: 270,  categoryId: cat('Utilities').id },
      { budgetYearId: smithSim.id, label: 'House insurance',   amount: 900,  frequency: 'ANNUAL',  monthlyEquivalent: 75,   categoryId: cat('Insurance').id },
    ],
  })

  // Alice: Job "Product Manager @ Acme" with 2 salary records + 1 annual bonus
  const aliceJob = await prisma.job.create({
    data: {
      userId: alice.id,
      name: 'Product Manager',
      employer: 'Acme Corp',
      startDate: new Date(`${currentYear - 2}-03-01`),
    },
  })
  await prisma.salaryRecord.createMany({
    data: [
      { jobId: aliceJob.id, grossAmount: 7000, netAmount: 5000, effectiveFrom: new Date(`${currentYear - 2}-03-01`) },
      { jobId: aliceJob.id, grossAmount: 7700, netAmount: 5500, effectiveFrom: new Date(`${currentYear - 1}-01-01`) },
    ],
  })
  await prisma.bonus.create({
    data: {
      jobId: aliceJob.id,
      label: 'Annual performance bonus',
      grossAmount: 14000,
      netAmount: 10000,
      paymentDate: new Date(`${currentYear}-03-15`),
      includeInBudget: true,
      budgetMode: 'SPREAD_ANNUALLY',
    },
  })
  await prisma.householdIncomeAllocation.createMany({
    data: [
      { jobId: aliceJob.id, budgetYearId: smithActive.id, allocationPct: 100 },
      { jobId: aliceJob.id, budgetYearId: smithRetired.id, allocationPct: 100 },
    ],
  })

  // Bob: Job "Software Engineer @ Beta" with 1 salary record + 1 upcoming bonus
  const bobJob = await prisma.job.create({
    data: {
      userId: bob.id,
      name: 'Software Engineer',
      employer: 'Beta Systems',
      startDate: new Date(`${currentYear - 1}-06-01`),
    },
  })
  await prisma.salaryRecord.create({
    data: { jobId: bobJob.id, grossAmount: 5800, netAmount: 4200, effectiveFrom: new Date(`${currentYear - 1}-06-01`) },
  })
  await prisma.bonus.create({
    data: {
      jobId: bobJob.id,
      label: 'Q2 project completion bonus',
      grossAmount: 3000,
      netAmount: 2200,
      paymentDate: new Date(`${currentYear}-06-30`),
      includeInBudget: true,
      budgetMode: 'ONE_OFF',
    },
  })
  await prisma.householdIncomeAllocation.createMany({
    data: [
      { jobId: bobJob.id, budgetYearId: smithActive.id, allocationPct: 100 },
      { jobId: bobJob.id, budgetYearId: smithRetired.id, allocationPct: 100 },
    ],
  })

  console.log('✓ Created Smith Family household (2 budget years + 1 simulation)')

  // ── Household 2: Carol & Dave ──────────────────────────────────────────────
  const cdHousehold = await prisma.household.create({
    data: {
      name: 'Carol & Dave',
      members: {
        create: [
          { userId: carol.id, role: 'ADMIN' },
          { userId: dave.id,  role: 'MEMBER' },
        ],
      },
    },
  })

  const cdActive = await prisma.budgetYear.create({
    data: { householdId: cdHousehold.id, year: currentYear, status: 'ACTIVE' },
  })
  await prisma.expense.createMany({
    data: [
      { budgetYearId: cdActive.id, label: 'Apartment rent',  amount: 2400, frequency: 'MONTHLY', monthlyEquivalent: 2400, categoryId: cat('Housing').id },
      { budgetYearId: cdActive.id, label: 'Internet',        amount: 60,   frequency: 'MONTHLY', monthlyEquivalent: 60,   categoryId: cat('Utilities').id },
      { budgetYearId: cdActive.id, label: 'Grocery run',     amount: 500,  frequency: 'MONTHLY', monthlyEquivalent: 500,  categoryId: cat('Food & Groceries').id },
      { budgetYearId: cdActive.id, label: 'Gym memberships', amount: 100,  frequency: 'MONTHLY', monthlyEquivalent: 100,  categoryId: cat('Healthcare').id },
      { budgetYearId: cdActive.id, label: 'Public transport',amount: 200,  frequency: 'MONTHLY', monthlyEquivalent: 200,  categoryId: cat('Transport').id },
    ],
  })
  await prisma.savingsEntry.create({
    data: { budgetYearId: cdActive.id, label: 'Joint savings', amount: 500, frequency: 'MONTHLY', monthlyEquivalent: 500 },
  })

  const carolJob = await prisma.job.create({
    data: {
      userId: carol.id,
      name: 'Marketing Manager',
      employer: 'Global Media',
      startDate: new Date(`${currentYear - 3}-01-01`),
    },
  })
  await prisma.salaryRecord.create({
    data: { jobId: carolJob.id, grossAmount: 8300, netAmount: 6000, effectiveFrom: new Date(`${currentYear - 3}-01-01`) },
  })
  await prisma.householdIncomeAllocation.create({
    data: { jobId: carolJob.id, budgetYearId: cdActive.id, allocationPct: 100 },
  })

  const daveJob = await prisma.job.create({
    data: {
      userId: dave.id,
      name: 'Freelance Developer',
      startDate: new Date(`${currentYear - 2}-04-01`),
    },
  })
  await prisma.salaryRecord.create({
    data: { jobId: daveJob.id, grossAmount: 4800, netAmount: 3500, effectiveFrom: new Date(`${currentYear - 2}-04-01`) },
  })
  await prisma.householdIncomeAllocation.create({
    data: { jobId: daveJob.id, budgetYearId: cdActive.id, allocationPct: 100 },
  })

  console.log('✓ Created Carol & Dave household (1 active budget year)')
  console.log('Demo data complete. Log in as alice@demo.local / demo1234 to explore.')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
