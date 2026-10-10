import 'dotenv/config'
import { prisma } from '../lib/db'
import { requireConfiguredOwner } from '../lib/identity'
import { taskHierarchyReport } from '../lib/services/tasks'

async function main() {
  const report = await taskHierarchyReport(requireConfiguredOwner())
  console.log(JSON.stringify(report, null, 2))
}
main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
