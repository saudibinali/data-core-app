import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import './lib/i18n'
import { ThemeProvider } from './components/theme-provider'
import { useTranslation } from 'react-i18next'

function RootApp() {
  const { i18n } = useTranslation();
  
  useEffect(() => {
    document.documentElement.dir = i18n.dir();
  }, [i18n, i18n.language]);

  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <RootApp />
    </ThemeProvider>
  </StrictMode>,
)
