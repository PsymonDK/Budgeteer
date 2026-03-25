import React from 'react'

interface AvatarUser {
  name: string
  role?: string
  avatarUrl?: string | null
}

interface AvatarProps {
  user: AvatarUser
  size?: number
  className?: string
}

const PALETTE = ['#1e3a5f','#b45309','#be4040','#0f766e','#7c3aed','#0369a1','#047857','#9d174d']

function nameToColour(name: string): string {
  let h = 0
  for (const c of name) h = ((h * 31) + c.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? '?'
  return ((parts[0][0] ?? '') + (parts[parts.length - 1][0] ?? '')).toUpperCase()
}

export default function Avatar({ user, size = 32, className = '' }: AvatarProps) {
  const isElevated = user.role === 'SYSTEM_ADMIN' || user.role === 'BOOKKEEPER'
  const ringClass = isElevated ? 'ring-2 ring-amber-400 ring-offset-1 ring-offset-gray-950' : ''

  const style: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    flexShrink: 0,
  }

  if (user.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt={user.name}
        style={style}
        className={`object-cover ${ringClass} ${className}`}
      />
    )
  }

  const initials = getInitials(user.name)
  const bg = nameToColour(user.name)
  const fontSize = Math.round(size * 0.38)

  return (
    <div
      style={{ ...style, background: bg, fontSize }}
      className={`flex items-center justify-center text-white font-semibold select-none ${ringClass} ${className}`}
    >
      {initials}
    </div>
  )
}
