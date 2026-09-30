import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import AuthGate from './features/auth/AuthGate.jsx'
import { applyTheme } from './shell/theme'

applyTheme() // the saved theme's bar colors (index.html has already set the rest)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthGate />
  </StrictMode>,
)
