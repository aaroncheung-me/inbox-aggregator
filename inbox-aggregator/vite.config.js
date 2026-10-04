import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const src = file => fileURLToPath(new URL(`./src/${file}`, import.meta.url)).replace(/\\/g, '/')

// The public demo (`--mode demo`): the real app on made-up data. Only these
// two files change, everything else is the app as it is: api.js becomes an
// in-browser fake and supabase.js a fake signed-in session, so the demo never
// talks to the real server or Supabase (their addresses aren't even in it).
const DEMO_SWAPS = new Map([
  [src('api.js'), src('demo/api.js')],
  [src('supabase.js'), src('demo/supabase.js')],
])

function demoSwaps() {
  return {
    name: 'demo-swaps',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || importer.replace(/\\/g, '/').includes('/src/demo/')) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      return (resolved && DEMO_SWAPS.get(resolved.id.split('?')[0].replace(/\\/g, '/'))) || null
    },
    transformIndexHtml: html => html.replace('<title>Inbox</title>', '<title>Inbox Aggregator (demo)</title>'),
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [mode === 'demo' && demoSwaps(), react()],
}))
