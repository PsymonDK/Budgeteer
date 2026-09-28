import type { AccountInfo, Ownership } from '../../api/types'

/** Owner-name badge for individual entries, "Custom split" badge for custom splits. */
export function OwnershipBadges({ ownership, ownedBy }: { ownership: Ownership; ownedBy: { name: string } | null }) {
  return (
    <>
      {ownership === 'INDIVIDUAL' && ownedBy && (
        <span className="text-xs bg-blue-900/60 text-blue-300 border border-blue-700/50 px-2 py-0.5 rounded-full">
          {ownedBy.name}
        </span>
      )}
      {ownership === 'CUSTOM' && (
        <span className="text-xs bg-purple-900/60 text-purple-300 border border-purple-700/50 px-2 py-0.5 rounded-full">
          Custom split
        </span>
      )}
    </>
  )
}

/** Account-name badge shown next to an entry's label. */
export function AccountBadge({ account }: { account: AccountInfo | null }) {
  if (!account) return null
  return (
    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-800 text-gray-400 border border-gray-700">
      {account.name}
    </span>
  )
}
