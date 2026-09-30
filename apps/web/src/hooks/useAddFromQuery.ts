import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Opens a page's add form when the URL carries `?add=1` (used by the phone tab bar's Add button),
 * then removes the param so a reload or back navigation doesn't open it again.
 *
 * `canAdd`: `null` while the page is still loading, `false` when adding isn't possible
 * (e.g. a read-only budget year), `true` to open the form.
 */
export function useAddFromQuery(canAdd: boolean | null, openAdd: () => void) {
  const [searchParams, setSearchParams] = useSearchParams()
  const wantsAdd = searchParams.get('add') === '1'

  useEffect(() => {
    if (!wantsAdd || canAdd === null) return
    if (canAdd) openAdd()
    setSearchParams((params) => { params.delete('add'); return params }, { replace: true })
  }, [wantsAdd, canAdd, openAdd, setSearchParams])
}
