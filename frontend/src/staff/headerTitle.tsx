import { createContext, useContext, useEffect } from 'react'

export interface HeaderTitleValue {
  title: string
  subtitle: string
  setTitle: (title: string) => void
  setSubtitle: (subtitle: string) => void
}

export const HeaderTitleContext = createContext<HeaderTitleValue>({
  title: '',
  subtitle: '',
  setTitle: () => {},
  setSubtitle: () => {},
})

export function useHeaderTitle(): HeaderTitleValue {
  return useContext(HeaderTitleContext)
}

/**
 * Set the page title (and optional subtitle) shown in the staff header bar
 * and keep them in sync whenever the values change.
 */
export function useHeaderTitleValue(title: string, subtitle = ''): void {
  const { setTitle, setSubtitle } = useHeaderTitle()
  useEffect(() => {
    setTitle(title)
    setSubtitle(subtitle)
  }, [title, subtitle, setTitle, setSubtitle])
}
