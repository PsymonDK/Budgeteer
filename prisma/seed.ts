import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcryptjs'
import fs from 'node:fs'
import path from 'node:path'
import { parseCsvRows } from '../apps/api/src/lib/csv'
import { merchantMappingKey, normalizeClassifierTerm, normalizeReceiptLabel } from '../apps/api/src/lib/receiptText'

// Local runs read the repo-root .env; existing env vars (Docker) win.
if (fs.existsSync('.env')) process.loadEnvFile('.env')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL as string }) })

const DEFAULT_CATEGORIES: { name: string; icon: string }[] = [
  { name: 'Housing',         icon: 'Home' },
  { name: 'Transport',       icon: 'Car' },
  { name: 'Utilities',       icon: 'Zap' },
  { name: 'Food & Groceries',icon: 'ShoppingCart' },
  { name: 'Shared Household Spending', icon: 'ShoppingBasket' },
  { name: 'Insurance',       icon: 'Shield' },
  { name: 'Subscriptions',   icon: 'RefreshCw' },
  { name: 'Healthcare',      icon: 'Heart' },
  { name: 'Other',           icon: 'Tag' },
]

const DEFAULT_RECEIPT_SUBCATEGORIES: Record<string, string[]> = {
  'Food & Groceries': ['Food'],
  'Shared Household Spending': [
    'Groceries',
    'Food',
    'Dairy',
    'Bread & Bakery',
    'Meat',
    'Fish & Seafood',
    'Vegetables',
    'Fruit',
    'Pantry',
    'Condiments',
    'Frozen',
    'Snacks',
    'Candy',
    'Drinks',
    'Soda',
    'Coffee & Tea',
    'Breakfast',
    'Baby food',
    'Alcohol',
    'Beer',
    'Wine',
    'Toys',
    'Household goods',
    'Household supplies',
    'Paper goods',
    'Cleaning',
    'Laundry',
    'Cleaning & Laundry',
    'Kitchen supplies',
    'Bags & Foil',
    'Batteries',
    'Light bulbs',
    'Personal care',
    'Hygiene',
    'Hair care',
    'Skin care',
    'Dental',
    'Shaving',
    'Deodorant',
    'Cosmetics',
    'Pharmacy',
    'Medicine',
    'Baby & children',
    'Diapers',
    'Baby care',
    'Baby food',
    'School supplies',
    'Pets',
    'Pet food',
    'Pet supplies',
    'Clothing',
    'Shoes',
    'Accessories',
    'Gifts & misc',
    'Gifts',
    'Books',
    'Games',
    'Flowers',
    'Electronics accessories',
  ],
  Transport: ['Fuel', 'Public transport', 'Parking', 'Taxi'],
  Subscriptions: ['Streaming', 'Software', 'Memberships'],
  Healthcare: ['Medicine', 'Doctor', 'Dental'],
  Utilities: ['Electricity', 'Water', 'Heating', 'Internet'],
  Other: ['Unsorted'],
}

const DEFAULT_RECEIPT_CLASSIFIER_TERMS: Array<{ termType: 'NOISE_TOKEN' | 'LOW_VALUE_WORD' | 'OCR_ALIAS'; term: string }> = [
  ...['stk', 'pcs', 'pc', 'kg', 'g', 'l', 'ml', 'cl', 'cm', 'mm', 'ltr', 'liter', 'gram', 'varenr', 'vare', 'nr', 'dk', 'kr', 'dkk']
    .map((term) => ({ termType: 'NOISE_TOKEN' as const, term })),
  ...['total', 'subtotal', 'sum', 'i alt', 'ialt', 'at betale', 'betale', 'til betaling', 'betaling', 'betalt', 'beløb', 'belob', 'change', 'cash', 'card', 'kort', 'kreditkort', 'betalingskort', 'visa', 'mastercard', 'dankort', 'mobilepay', 'kontant', 'tax', 'vat', 'moms', 'rabat', 'rabatten', 'retur']
    .map((term) => ({ termType: 'LOW_VALUE_WORD' as const, term })),
]

const DEFAULT_SAVINGS_CATEGORIES: { name: string; icon: string }[] = [
  { name: 'Vacation',       icon: 'Plane' },
  { name: 'Renovation',     icon: 'Hammer' },
  { name: 'Rainy Day Fund', icon: 'Umbrella' },
  { name: 'General',        icon: 'PiggyBank' },
]

const DEFAULT_CURRENCIES: { code: string; name: string }[] = [
  { code: 'DKK', name: 'Danish Krone' },
  { code: 'EUR', name: 'Euro' },
  { code: 'USD', name: 'US Dollar' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'SEK', name: 'Swedish Krona' },
  { code: 'NOK', name: 'Norwegian Krone' },
  { code: 'CHF', name: 'Swiss Franc' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'PLN', name: 'Polish Zloty' },
  { code: 'CZK', name: 'Czech Koruna' },
  { code: 'HUF', name: 'Hungarian Forint' },
  { code: 'RON', name: 'Romanian Leu' },
  { code: 'BGN', name: 'Bulgarian Lev' },
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
    // Never log the password: container logs are often shipped elsewhere
    console.log(`✓ Created admin user: ${admin.email} (password from ADMIN_PASSWORD; change it on first login)`)
  }

  // ── Default system-wide expense categories (idempotent) ───────────────────
  let seeded = 0
  for (const { name: categoryName, icon } of DEFAULT_CATEGORIES) {
    const existing = await prisma.category.findFirst({
      where: { name: categoryName, isSystemWide: true, categoryType: 'EXPENSE' },
    })
    if (!existing) {
      await prisma.category.create({
        data: { name: categoryName, icon, categoryType: 'EXPENSE', isSystemWide: true, createdByUserId: admin.id },
      })
      seeded++
    } else if (existing.icon !== icon) {
      await prisma.category.update({
        where: { id: existing.id },
        data: { icon },
      })
    }
  }
  if (seeded > 0) console.log(`✓ Seeded ${seeded} default expense categories.`)
  else console.log(`Default expense categories already exist, skipping.`)

  // ── Default system-wide receipt subcategories (idempotent) ────────────────
  let subcategoriesSeeded = 0
  for (const [categoryName, subcategories] of Object.entries(DEFAULT_RECEIPT_SUBCATEGORIES)) {
    const category = await prisma.category.findFirst({
      where: { name: categoryName, isSystemWide: true, categoryType: 'EXPENSE' },
    })
    if (!category) continue

    for (const subcategoryName of subcategories) {
      const existing = await prisma.receiptSubcategory.findFirst({
        where: { categoryId: category.id, householdId: null, name: { equals: subcategoryName, mode: 'insensitive' } },
      })
      if (existing) continue
      await prisma.receiptSubcategory.create({
        data: { categoryId: category.id, name: subcategoryName, isSystemWide: true },
      })
      subcategoriesSeeded++
    }
  }
  if (subcategoriesSeeded > 0) console.log(`✓ Seeded ${subcategoriesSeeded} default receipt subcategories.`)
  else console.log(`Default receipt subcategories already exist, skipping.`)

  // ── Default receipt classifier terms (idempotent) ────────────────────────
  let classifierTermsSeeded = 0
  for (const term of DEFAULT_RECEIPT_CLASSIFIER_TERMS) {
    await prisma.receiptClassifierTerm.upsert({
      where: { scopeKey_termType_term: { scopeKey: 'system', termType: term.termType, term: term.term } },
      create: { scopeKey: 'system', ...term, source: 'SYSTEM' },
      update: {},
    })
    classifierTermsSeeded++
  }
  console.log(`✓ Ensured ${classifierTermsSeeded} default receipt classifier terms.`)
  await seedReceiptTrainingSeed()

  // ── Default system-wide savings categories (idempotent) ────────────────────
  let savingsSeeded = 0
  for (const { name: categoryName, icon } of DEFAULT_SAVINGS_CATEGORIES) {
    const existing = await prisma.category.findFirst({
      where: { name: categoryName, isSystemWide: true, categoryType: 'SAVINGS' },
    })
    if (!existing) {
      await prisma.category.create({
        data: { name: categoryName, icon, categoryType: 'SAVINGS', isSystemWide: true, createdByUserId: admin.id },
      })
      savingsSeeded++
    } else if (existing.icon !== icon) {
      await prisma.category.update({
        where: { id: existing.id },
        data: { icon },
      })
    }
  }
  if (savingsSeeded > 0) console.log(`✓ Seeded ${savingsSeeded} default savings categories.`)
  else console.log(`Default savings categories already exist, skipping.`)

  // ── Default currencies (idempotent) ────────────────────────────────────────
  let currenciesSeeded = 0
  for (const { code, name } of DEFAULT_CURRENCIES) {
    const existing = await prisma.currency.findUnique({ where: { code } })
    if (!existing) {
      await prisma.currency.create({ data: { code, name } })
      currenciesSeeded++
    }
  }
  if (currenciesSeeded > 0) console.log(`✓ Seeded ${currenciesSeeded} default currencies.`)
  else console.log(`Default currencies already exist, skipping.`)

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

  const categories = await prisma.category.findMany({ where: { isSystemWide: true } })
  const cat = (name: string) => categories.find((c) => c.name === name)!

  const currentYear = new Date().getFullYear()

  // ── Household 1: Smith Family ──────────────────────────────────────────────
  const smithHousehold = await prisma.household.create({
    data: {
      name: 'The Smith Family',
      // Standing order on payday; Carol & Dave make theirs by hand (the default)
      transferPaymentMethod: 'AUTOMATIC',
      transferDueDay: 25,
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
      { budgetYearId: smithActive.id, dueDay: 1, label: 'Rent',              amount: 1900, frequency: 'MONTHLY',      monthlyEquivalent: 1900,                 categoryId: cat('Housing').id },
      { budgetYearId: smithActive.id, label: 'Groceries',         amount: 650,  frequency: 'MONTHLY',      monthlyEquivalent: 650,                  categoryId: cat('Food & Groceries').id },
      { budgetYearId: smithActive.id, dueDay: 15, label: 'Car insurance',     amount: 1320, frequency: 'ANNUAL',       monthlyEquivalent: 110,                  categoryId: cat('Insurance').id },
      { budgetYearId: smithActive.id, dueDay: 20, label: 'Electricity',       amount: 270,  frequency: 'MONTHLY',      monthlyEquivalent: 270,                  categoryId: cat('Utilities').id },
      { budgetYearId: smithActive.id, dueDay: 12, label: 'Netflix',           amount: 18,   frequency: 'MONTHLY',      monthlyEquivalent: 18,                   categoryId: cat('Subscriptions').id },
      { budgetYearId: smithActive.id, dueDay: 25, label: 'Spotify',           amount: 12,   frequency: 'MONTHLY',      monthlyEquivalent: 12,                   categoryId: cat('Subscriptions').id },
      { budgetYearId: smithActive.id, dueDay: 5, paymentMethod: 'MANUAL', label: 'Health check-ups',  amount: 600,  frequency: 'ANNUAL',       monthlyEquivalent: 50,                   categoryId: cat('Healthcare').id },
      { budgetYearId: smithActive.id, label: 'Car fuel',          amount: 80,   frequency: 'WEEKLY',       monthlyEquivalent: parseFloat((80 * 52 / 12).toFixed(2)), categoryId: cat('Transport').id },
    ],
  })
  await prisma.savingsEntry.createMany({
    data: [
      { budgetYearId: smithActive.id, dueDay: 2, label: 'Emergency fund', amount: 400, frequency: 'MONTHLY', monthlyEquivalent: 400 },
      { budgetYearId: smithActive.id, dueDay: 28, paymentMethod: 'MANUAL', label: 'Holiday fund',   amount: 150, frequency: 'MONTHLY', monthlyEquivalent: 150 },
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
      { budgetYearId: cdActive.id, dueDay: 1, label: 'Apartment rent',  amount: 2400, frequency: 'MONTHLY', monthlyEquivalent: 2400, categoryId: cat('Housing').id },
      { budgetYearId: cdActive.id, dueDay: 8, label: 'Internet',        amount: 60,   frequency: 'MONTHLY', monthlyEquivalent: 60,   categoryId: cat('Utilities').id },
      { budgetYearId: cdActive.id, label: 'Grocery run',     amount: 500,  frequency: 'MONTHLY', monthlyEquivalent: 500,  categoryId: cat('Food & Groceries').id },
      { budgetYearId: cdActive.id, dueDay: 3, paymentMethod: 'MANUAL', label: 'Gym memberships', amount: 100,  frequency: 'MONTHLY', monthlyEquivalent: 100,  categoryId: cat('Healthcare').id },
      { budgetYearId: cdActive.id, dueDay: 26, label: 'Public transport',amount: 200,  frequency: 'MONTHLY', monthlyEquivalent: 200,  categoryId: cat('Transport').id },
    ],
  })
  await prisma.savingsEntry.create({
    data: { budgetYearId: cdActive.id, dueDay: 2, paymentMethod: 'MANUAL', label: 'Joint savings', amount: 500, frequency: 'MONTHLY', monthlyEquivalent: 500 },
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

async function seedReceiptTrainingSeed() {
  const seedPath = path.join(process.cwd(), 'prisma', 'receipt-training-seed.csv')
  if (!fs.existsSync(seedPath)) return

  const rows = parseSeedCsv(fs.readFileSync(seedPath, 'utf8'))
  const categories = await prisma.category.findMany({
    where: { categoryType: 'EXPENSE', isActive: true, isSystemWide: true },
    include: { receiptSubcategories: { where: { isActive: true } } },
  })
  const categoryByName = new Map(categories.map((category) => [nameKey(category.name), category]))

  let termsSeeded = 0
  let mappingSeeded = 0
  for (const row of rows) {
    const termType = row.termType?.trim().toUpperCase()
    const term = normalizeClassifierTerm(termType, row.term ?? '') ?? ''
    if ((termType === 'NOISE_TOKEN' || termType === 'LOW_VALUE_WORD' || termType === 'OCR_ALIAS') && term) {
      await prisma.receiptClassifierTerm.upsert({
        where: { scopeKey_termType_term: { scopeKey: 'system', termType, term } },
        create: {
          scopeKey: 'system',
          termType,
          term,
          isActive: parseSeedBoolean(row.isActive, true),
          source: 'RECEIPT_SEED',
        },
        update: {
          isActive: parseSeedBoolean(row.isActive, true),
        },
      })
      termsSeeded++
      continue
    }

    // Same normalization as runtime lookups, so seeded mappings actually match
    const normalizedLabel = normalizeReceiptLabel(row.normalizedLabel ?? '')
    const category = categoryByName.get(nameKey(row.categoryName ?? ''))
    if (!normalizedLabel || !category) continue
    const subcategoryName = row.subcategoryName?.trim()
    const subcategory = subcategoryName
      ? category.receiptSubcategories.find((candidate) => nameKey(candidate.name) === nameKey(subcategoryName))
      : null
    const merchantKey = merchantMappingKey(row.merchantKey || row.merchantName || '')
    const confidence = Number(row.confidence) || 0.85
    await prisma.receiptCategoryMapping.upsert({
      where: {
        scopeKey_normalizedLabel_merchantKey: {
          scopeKey: 'system',
          normalizedLabel,
          merchantKey,
        },
      },
      create: {
        scopeKey: 'system',
        householdId: null,
        normalizedLabel,
        merchantKey,
        categoryId: category.id,
        subcategoryId: subcategory?.id ?? null,
        confidence,
        hitCount: 1,
      },
      // Existing rows keep any admin edits (this runs on every boot)
      update: {},
    })
    const deduped = await prisma.receiptCategoryMapping.deleteMany({
      where: {
        NOT: { scopeKey: 'system' },
        normalizedLabel,
        merchantKey,
        categoryId: category.id,
        subcategoryId: subcategory?.id ?? null,
        hitCount: 1,
      },
    })
    mappingSeeded += 1 + deduped.count
  }

  console.log(`✓ Ensured receipt training seed (${termsSeeded} terms, ${mappingSeeded} mappings/dedupes).`)
}

function parseSeedCsv(text: string): Array<Record<string, string>> {
  const [header = [], ...body] = parseCsvRows(text)
  return body
    .filter((cells) => cells.some((value) => value.trim()))
    .map((cells) => Object.fromEntries(header.map((name, index) => [name, cells[index]?.trim() ?? ''])))
}

function nameKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}





function parseSeedBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return fallback
  if (['true', '1', 'yes', 'active'].includes(normalized)) return true
  if (['false', '0', 'no', 'inactive'].includes(normalized)) return false
  return fallback
}

/**
 * Every household needs its monthly transfer automation. Households created through
 * the API get one; seeded demo households and older installs may not. Idempotent.
 */
async function ensureHouseholdAutomations() {
  const households = await prisma.household.findMany({
    where: { automations: { none: { key: 'monthly_transfer_snapshot' } } },
    select: { id: true },
  })
  for (const { id } of households) {
    await prisma.automation.create({
      data: {
        key: 'monthly_transfer_snapshot',
        label: 'Monthly budget transfer calculation',
        description: 'Calculates and records the recommended monthly transfer on the 1st of each month',
        schedule: '0 0 1 * *',
        householdId: id,
      },
    })
  }
  if (households.length > 0) console.log(`✓ Added monthly transfer automation to ${households.length} household(s).`)
}

/**
 * One-off repair (2026-09) after the receipt label normalization fix: keys used to
 * be built with plain NFKD, which split "å" and mid-word accents ("blåbær" became
 * "bla bær"). Line items whose stored key is exactly the old result for their label
 * get the new key, and household mappings stored under the old key move with them
 * (merging into an existing mapping when the new key already exists). Keys built
 * differently (e.g. with household noise words) are left alone. Idempotent.
 */
async function rekeyReceiptLabels() {
  const legacyKey = (label: string) => normalizeReceiptLabel(label.normalize('NFKD').replace(/\p{M}/gu, ' '))
  const rows = await prisma.$queryRaw<Array<{ id: string; label: string; normalizedLabel: string; householdId: string }>>`
    SELECT li.id, li.label, li."normalizedLabel", r."householdId"
    FROM "ReceiptLineItem" li JOIN "Receipt" r ON r.id = li."receiptId"
    WHERE li.label ~ '[^[:ascii:]]'`
  const moves = new Map<string, { householdId: string; from: string; to: string }>()
  let lines = 0
  for (const row of rows) {
    const next = normalizeReceiptLabel(row.label)
    if (next === row.normalizedLabel || row.normalizedLabel !== legacyKey(row.label)) continue
    await prisma.receiptLineItem.update({ where: { id: row.id }, data: { normalizedLabel: next } })
    moves.set(`${row.householdId}|${row.normalizedLabel}`, { householdId: row.householdId, from: row.normalizedLabel, to: next })
    lines++
  }

  let mappings = 0
  for (const { householdId, from, to } of moves.values()) {
    for (const old of await prisma.receiptCategoryMapping.findMany({ where: { scopeKey: householdId, normalizedLabel: from } })) {
      const target = await prisma.receiptCategoryMapping.findUnique({
        where: { scopeKey_normalizedLabel_merchantKey: { scopeKey: householdId, normalizedLabel: to, merchantKey: old.merchantKey } },
      })
      if (target) {
        await prisma.$transaction([
          prisma.receiptCategoryMapping.update({ where: { id: target.id }, data: { hitCount: { increment: old.hitCount } } }),
          prisma.receiptCategoryMapping.delete({ where: { id: old.id } }),
        ])
      } else {
        await prisma.receiptCategoryMapping.update({ where: { id: old.id }, data: { normalizedLabel: to } })
      }
      mappings++
    }
  }
  if (lines > 0 || mappings > 0) console.log(`✓ Re-keyed ${lines} receipt line(s) and ${mappings} mapping(s) after the label normalization fix.`)
}

main()
  .then(() => ensureHouseholdAutomations())
  .then(() => rekeyReceiptLabels())
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
