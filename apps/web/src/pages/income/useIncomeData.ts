import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../api/client'
import { qk } from '../../api/queryKeys'
import { useConfig, useCurrencies, useHouseholds } from '../../api/queries'
import { useAuth } from '../../contexts/AuthContext'
import type { Bonus, Job, MonthlyOverride, Tab, TaxCardSettings } from './types'

/**
 * Server state for the income screen: whose income is shown (self, or a proxy
 * user for admins/bookkeepers), their jobs, and per-job overrides, bonuses and
 * tax cards. Overrides and bonuses load only while their tab is open.
 */
export function useIncomeData(activeTab: Tab) {
  const { user: me } = useAuth()
  const [params] = useSearchParams()
  const proxyUserId = params.get('proxyUserId')
  const isProxy = !!proxyUserId && (me?.role === 'SYSTEM_ADMIN' || me?.role === 'BOOKKEEPER')
  const targetUserId = isProxy ? proxyUserId : me?.id

  // Fetch users list to get proxy user name (only when acting as proxy)
  const { data: allUsers = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: qk.users(),
    queryFn: async () => (await api.get<{ id: string; name: string }[]>('/users')).data,
    enabled: isProxy,
  })
  const proxyUserName = isProxy ? allUsers.find((u) => u.id === proxyUserId)?.name : undefined

  const { data: config } = useConfig()
  const baseCurrency = config?.baseCurrency ?? 'DKK'

  const { data: currencies = [] } = useCurrencies()

  const { data: jobs = [], isLoading } = useQuery<Job[]>({
    queryKey: qk.jobs(targetUserId),
    queryFn: async () => (await api.get<Job[]>(`/users/${targetUserId}/jobs`)).data,
    enabled: !!targetUserId,
  })

  const { data: households = [] } = useHouseholds()

  // Load overrides for all jobs on the overrides tab
  const { data: allJobsOverrides = {} } = useQuery<Record<string, MonthlyOverride[]>>({
    queryKey: qk.allOverrides(jobs.map((j) => j.id).join(',')),
    queryFn: async () => {
      const results = await Promise.all(
        jobs.map(async (j) => {
          const res = await api.get<MonthlyOverride[]>(`/jobs/${j.id}/overrides`)
          return [j.id, res.data] as [string, MonthlyOverride[]]
        })
      )
      return Object.fromEntries(results)
    },
    enabled: activeTab === 'overrides' && jobs.length > 0,
  })

  // Load bonuses for all jobs on the bonuses tab
  const { data: allJobsBonuses = {} } = useQuery<Record<string, Bonus[]>>({
    queryKey: qk.allBonuses(jobs.map((j) => j.id).join(',')),
    queryFn: async () => {
      const results = await Promise.all(
        jobs.map(async (j) => {
          const res = await api.get<Bonus[]>(`/jobs/${j.id}/bonuses`)
          return [j.id, res.data] as [string, Bonus[]]
        })
      )
      return Object.fromEntries(results)
    },
    enabled: activeTab === 'bonuses' && jobs.length > 0,
  })

  const { data: taxCards = {} } = useQuery<Record<string, TaxCardSettings[]>>({
    queryKey: qk.taxCards(jobs.map((j) => j.id).join(',')),
    queryFn: async () => {
      const dkJobs = jobs.filter((j) => j.country === 'DK')
      const results = await Promise.all(
        dkJobs.map(async (j) => {
          const res = await api.get<TaxCardSettings[]>(`/jobs/${j.id}/taxcard`)
          return [j.id, res.data] as [string, TaxCardSettings[]]
        })
      )
      return Object.fromEntries(results)
    },
    enabled: jobs.length > 0,
  })

  return {
    isProxy, targetUserId, proxyUserName, baseCurrency, currencies,
    jobs, isLoading, households, allJobsOverrides, allJobsBonuses, taxCards,
  }
}
