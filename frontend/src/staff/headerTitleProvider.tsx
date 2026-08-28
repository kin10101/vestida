import { useState, type ReactNode } from 'react'
import { HeaderTitleContext } from './headerTitle'

export function HeaderTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  return (
    <HeaderTitleContext.Provider value={{ title, subtitle, setTitle, setSubtitle }}>
      {children}
    </HeaderTitleContext.Provider>
  )
}
