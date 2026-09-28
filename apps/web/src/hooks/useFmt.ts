import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

/**
 * Returns a fmt() function pre-loaded with the base currency code.
 * Formats a number as "1,234.56 DKK" (or just "1,234.56" while loading).
 * Pass `currency` to label a foreign-currency amount, or '' for no suffix.
 */
export function useFmt() {
  const { data } = useQuery({
    queryKey: ['config'],
    queryFn: async () => (await api.get<{ baseCurrency: string }>('/config')).data,
    staleTime: Infinity,
  })
  const currency = data?.baseCurrency ?? ''
  return (v: number | string, suffix: string = currency) => {
    const n = Number(v).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return suffix ? `${n} ${suffix}` : n
  }
}

/** Returns the base currency code (empty string while loading). */
export function useBaseCurrency() {
  const { data } = useQuery({
    queryKey: ['config'],
    queryFn: async () => (await api.get<{ baseCurrency: string }>('/config')).data,
    staleTime: Infinity,
  })
  return data?.baseCurrency ?? ''
}
