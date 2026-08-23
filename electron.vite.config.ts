import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      define: {
        'import.meta.env.MAIN_VITE_FEISHU_OAUTH_BROKER_URL': JSON.stringify(
          process.env.MAIN_VITE_FEISHU_OAUTH_BROKER_URL
          || process.env.FEISHU_OAUTH_BROKER_URL
          || env.MAIN_VITE_FEISHU_OAUTH_BROKER_URL
          || env.FEISHU_OAUTH_BROKER_URL
          || ''
        )
      }
    },
    preload: {
      plugins: [externalizeDepsPlugin()]
    },
    renderer: {
      plugins: [react()]
    }
  }
})
