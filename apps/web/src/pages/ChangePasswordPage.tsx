import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { api, setAccessToken } from '../api/client'
import { useAuth } from '../contexts/AuthContext'
import { inputClass, primaryBtn, secondaryBtn } from '../lib/styles'
import { FormError } from '../components/FormError'
import { Page } from '../components/Page'

export function ChangePasswordPage() {
  const { user, updateUser } = useAuth()
  const navigate = useNavigate()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [isPending, setIsPending] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match')
      return
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters')
      return
    }

    setIsPending(true)
    try {
      const res = await api.post<{ accessToken: string }>(
        '/users/me/change-password',
        { currentPassword, newPassword },
      )
      // Changing the password ends every session; this one continues with the fresh
      // access token (the new refresh token arrived as a cookie)
      setAccessToken(res.data.accessToken)
      updateUser({ mustChangePassword: false })
      navigate('/', { replace: true })
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError((err.response?.data as { error?: string })?.error ?? 'Failed to change password')
      }
    } finally {
      setIsPending(false)
    }
  }

  const isMandatory = user?.mustChangePassword ?? false

  return (
    <>
      <Page template="form" className="flex justify-center">
        <div className="w-full max-w-sm">
          {isMandatory && (
            <div className="mb-6 bg-amber-950 border border-amber-700 rounded-lg px-4 py-3 text-sm text-amber-300">
              You must set a new password before continuing.
            </div>
          )}

          <h1 className="text-2xl font-semibold mb-6">Change password</h1>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Current password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                autoFocus
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">New password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                placeholder="Min. 8 characters"
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Confirm new password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className={inputClass}
              />
            </div>

            <FormError message={error} />

            <div className="flex gap-3 pt-2">
              <button
                type="submit"
                disabled={isPending}
                className={`flex-1 ${primaryBtn}`}
              >
                {isPending ? 'Saving…' : 'Change password'}
              </button>
              {!isMandatory && (
                <button
                  type="button"
                  onClick={() => navigate(-1)}
                  className={`flex-1 ${secondaryBtn}`}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>
      </Page>
    </>
  )
}
