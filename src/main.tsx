import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ManualMasteringPage from './components/ManualMasteringPage'
import SharedResultPage from './components/SharedResultPage'
import './index.css'
import { inject } from '@vercel/analytics';

inject()

const isManualMastering = new URLSearchParams(window.location.search).get('manualMastering') === '1'
const sharedSlug = new URLSearchParams(window.location.search).get('share')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {sharedSlug ? <SharedResultPage slug={sharedSlug} /> : isManualMastering ? <ManualMasteringPage /> : <App />}
  </React.StrictMode>,
)
