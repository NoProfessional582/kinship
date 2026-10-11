import 'dotenv/config'
import { prisma } from '../lib/db'
import { requireConfiguredOwner } from '../lib/identity'
import { photoInventory } from '../lib/photo-lifecycle'

photoInventory(requireConfiguredOwner())
  .then((report) => console.log(JSON.stringify(report, null, 2)))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
