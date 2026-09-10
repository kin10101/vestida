import { useEffect } from 'react'

export default function useDismissOnScroll(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) {
      return
    }

    const handleScroll = () => onClose()
    window.addEventListener('scroll', handleScroll, { capture: true, passive: true })
    return () => window.removeEventListener('scroll', handleScroll, true)
  }, [open, onClose])
}
