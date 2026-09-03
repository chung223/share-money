import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import SharePage from './SharePage'
import '../styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SharePage />
  </StrictMode>,
)
