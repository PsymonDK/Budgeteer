import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

const DEFAULT_CATEGORIES = [
  'Housing',
  'Transport',
  'Utilities',
  'Food & Groceries',
  'Insurance',
  'Subscriptions',
  'Healthcare',
  'Savings',
  'Other',
]

async function main() {
  const email = process.env.ADMIN_EMAIL ?? 'admin@budgeteer.local'
  const password = process.env.ADMIN_PASSWORD ?? 'changeme123'
  const name = process.env.ADMIN_NAME ?? 'Admin'

  let user = await prisma.user.findUnique({ where: { email } })

  if (user) {
    console.log(`Admin user already exists (${email}), skipping user seed.`)
  } else {
    const passwordHash = await bcrypt.hash(password, 12)
    user = await prisma.user.create({
      data: {
        email,
        name,
        passwordHash,
        role: 'SYSTEM_ADMIN',
        mustChangePassword: true,
      },
    })
    console.log(`✓ Created admin user: ${user.email}`)
    console.log(`  Default password: ${password}`)
    console.log(`  Change this on first login.`)
  }

  // Seed default system-wide categories (idempotent)
  let seeded = 0
  for (const categoryName of DEFAULT_CATEGORIES) {
    const existing = await prisma.expenseCategory.findFirst({
      where: { name: categoryName, isSystemWide: true },
    })
    if (!existing) {
      await prisma.expenseCategory.create({
        data: {
          name: categoryName,
          isSystemWide: true,
          createdByUserId: user.id,
        },
      })
      seeded++
    }
  }

  if (seeded > 0) {
    console.log(`✓ Seeded ${seeded} default expense categories.`)
  } else {
    console.log(`Default categories already exist, skipping.`)
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
