import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { toast } from 'sonner'
import { api } from '../../api/client'
import { qk } from '../../api/queryKeys'
import type { Household } from '../../api/types'

/** Household name (inline rename for admins) and member count. */
export function HouseholdNameHeader({ householdId: id, household, isAdmin }: { householdId: string; household: Household; isAdmin: boolean }) {
  const queryClient = useQueryClient()
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const [nameError, setNameError] = useState('')

  const updateNameMutation = useMutation({
    mutationFn: (name: string) => api.put(`/households/${id}`, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.household(id) })
      queryClient.invalidateQueries({ queryKey: qk.households() })
      setEditingName(false)
      setNameError('')
      toast.success('Household renamed')
    },
    onError: (err) => {
      if (axios.isAxiosError(err)) {
        setNameError((err.response?.data as { error?: string })?.error ?? 'Failed to update name')
      }
    },
  })

  function handleNameSubmit(e: FormEvent) {
    e.preventDefault()
    setNameError('')
    updateNameMutation.mutate(nameValue)
  }

  function startEditName() {
    setNameValue(household?.name ?? '')
    setNameError('')
    setEditingName(true)
  }

  return (
    <div className="mb-8">
      {editingName ? (
        <form onSubmit={handleNameSubmit} className="flex items-center gap-3">
          <input
            type="text"
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            required
            autoFocus
            className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-white text-2xl font-semibold focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-colors"
          />
          <button type="submit" disabled={updateNameMutation.isPending} className="bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-gray-950 font-semibold text-sm px-4 py-2 rounded-lg transition-colors">
            {updateNameMutation.isPending ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => setEditingName(false)} className="bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm px-4 py-2 rounded-lg transition-colors">
            Cancel
          </button>
          {nameError && <span className="text-red-400 text-sm">{nameError}</span>}
        </form>
      ) : (
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">{household.name}</h1>
          {isAdmin && (
            <button onClick={startEditName} className="text-gray-500 hover:text-gray-300 transition-colors text-sm">
              Edit
            </button>
          )}
        </div>
      )}
      <p className="text-gray-400 text-sm mt-1">
        {household.members.length} {household.members.length === 1 ? 'member' : 'members'}
      </p>
    </div>
  )
}
