import {defineConfig} from 'vite'
import Shaken from 'vite-plugin-export-shaken'
import Inspect from 'vite-plugin-inspect'

export default defineConfig({
  plugins: [Inspect(), Shaken()],
  resolve: {
    alias: {
      '@': './alias'
    }
  }
})