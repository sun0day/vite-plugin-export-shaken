import {init, parse } from 'es-module-lexer'
import MagicString from 'magic-string'
import type { Plugin, Rollup, ViteDevServer, ResolvedConfig } from 'vite'

type NameToId = (name: string) => {
  id: string
  name?: string
}

interface ImportDecl {
  start: number
  end: number
  type: 'import' | 'export'
  names: Record<string, [string, string][]>
}

export interface ShakenPluginParams {
  map?: Record<string, NameToId>
}

const importReg = /(import|export)\s+\{?([^}]+)\}?\s+from/
const nameReg = /(\w+)(\s+as\s+(\S+)\b)?/

export default ({ map = {} }: ShakenPluginParams = {}) => {
  let isDev = false
  let server: ViteDevServer
  let routes: [RegExp, NameToId][]
  let viteConfig: ResolvedConfig

  return {
    enforce: 'post',
    name: 'vite:re-import-proxy',

    configureServer(_server) {
      isDev = 'pluginContainer' in _server
      server = _server
    },

    configResolved(config) {
      viteConfig = config
    },

    buildStart() {
      routes = Object.keys(map).reduce((acc, regStr) => {
        acc.push([new RegExp(regStr), map[regStr]])
        return acc
      }, [])
    },

    async transform(code, importer, _) {
      if (routes.length < 1) {
        return null
      }

      await init
      const imports = await parseImports(code, routes, this.resolve.bind(this)).catch(err => {
        viteConfig.logger.warn(`[vite:re-import-proxy]: unable to parse imports of ${importer}, ${err.message ?? err}`)
        return []
      })

      if (imports.length) {
        const s = new MagicString(code)

        imports.forEach(it => {
          s.overwrite(it.start, it.end, computeStatement(it))
        })

        return {
          code: s.toString(),
          map: s.generateMap({ hires: 'boundary', source: importer })
        }
      }
    }
  } as Plugin
}

async function parseImports(code: string, routes: [RegExp, NameToId][], resolve: Rollup.PluginContext['resolve']) {
  const [imports] = parse(code)

  return (await Promise.all(imports.map(async ({ n, s, ss, se }) => {
    const getId = routes.find(([reg]) => reg.test(n))?.[1]

    if (!getId) {
      return null
    }

    const st = code.slice(ss, s - 1)
    const [_, type, nameStr] = st.match(importReg)
    const nameArr = nameStr.split(',').map(nt => {
      const [_, name, __, nameAs] = nt.match(nameReg)
      return [name, nameAs]
    })
    const names = {}

    await Promise.all(nameArr.map(async n => {
      let { id, name } = getId(n[0]) ?? {}
      if (!id) {
        throw new Error(`could not remap imported "${n[0]}" from "${n}"`)
      }

      id = (await resolve(id)).id
      names[id] ??= []
      names[id].push([name ?? n[0], n[1] ?? n[0]])
    }))

    return {
      type,
      start: ss,
      end: se,
      names
    } as ImportDecl
  }))).filter(Boolean)
}

function computeStatement({
  type,
  names
}: ImportDecl,
) {
  let st = ''
  for (const id in names) {
    const nameStr = names[id].reduce((acc, [name, nameAs], index) => {
      if (name === '*') {
        return `* as ${nameAs}`
      }
      const s = `${name} as ${nameAs ?? name}`
      return index ? [acc, s].join(',') : s
    }, '')

    st += `\n${type} { ${nameStr} }from "${id}"`
  }

  return st
}

