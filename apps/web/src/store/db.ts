import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { PrismaProvider, SqlDialect } from '@stacksketch/core'
import { SAMPLE_DB_NAME, SAMPLE_DBML } from '@/lib/sampleDbml'

export type DbOutput = 'prisma' | 'sql' | 'types' | 'express' | 'next'
export type DbMobilePane = 'input' | 'tables' | 'code'

interface DbState {
  /** DBML, as Schemasketch saves it */
  source: string
  name: string
  output: DbOutput
  provider: PrismaProvider
  dialect: SqlDialect
  /** the file shown for outputs with several (Express, Next.js) */
  file: string
  mobilePane: DbMobilePane
  set: (patch: Partial<Omit<DbState, 'set'>>) => void
}

export const useDb = create<DbState>()(
  persist(
    (set) => ({
      source: SAMPLE_DBML,
      name: SAMPLE_DB_NAME,
      output: 'prisma',
      provider: 'postgresql',
      dialect: 'postgres',
      file: '',
      mobilePane: 'input',
      set: (patch) => set(patch),
    }),
    { name: 'stacksketch:db', version: 1 },
  ),
)
