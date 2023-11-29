import { defineConfig } from 'vite'
import Shaken from 'vite-plugin-import-proxy'
import Inspect from 'vite-plugin-inspect'

export default defineConfig({
  plugins: [Inspect(),
  Shaken({
    map: {
      '\\bbarrel1\\b': name => {
        if (/foo/.test(name)) {
          return {
            id: './utils/foo',
            name: { foo: 'foo1' }[name]
          }
        }
        if (/bar|default/.test(name)) {
          return {
            id: './utils/bar'
          }
        }
        if (/baz/.test(name)) {
          return {
            id: './utils/baz'
          }
        }
      },
      '\\bbarrel2\\b': name => {
        if (/nested/.test(name)) {
          return {
            id: './nested'
          }
        }
        if (/alias/.test(name)) {
          return {
            id: '@'
          }
        }
      },
    }
  })
  ],
  resolve: {
    alias: {
      '@': '../alias'
    }
  }
})