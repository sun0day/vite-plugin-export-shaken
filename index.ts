import { join } from 'path'
import { readFile } from 'node:fs/promises'
import { parse } from 'es-module-lexer'
import fg from 'fast-glob'
import MagicString from 'magic-string'
import type { Plugin, Rollup, ViteDevServer } from 'vite'

interface ReExportData {
  from: string,
  as: string,
  name?: string
}

type ReExportMap = Map<string, { code: string, exports: Record<string, ReExportData[]> }>

export interface ShakenPluginParams {
  root?: string
  patterns?: string | string[]
  ignore?: string[]
}

const exportAllRE = /export\s+\*(\s+as\s+(.+))?\s+from/

export default ({ root = process.cwd(), patterns = [`**/*.{js, ts, jsx, tsx, vue, svelte}`], ignore = []}: ShakenPluginParams = {}) => {
  let isDev = false
  let server: ViteDevServer
  let reExports: ReExportMap
  let findReExportFilesPromise = findReExportFiles({ root, patterns, ignore: ['**/node_modules', ...ignore]})
  let parsePromise: Promise<PromiseSettledResult<void>[]>

  return {
    enforce: 'post',
    name: 'vite:re-export-shaken',


    configureServer(_server) {
      isDev = 'pluginContainer' in _server
      server = _server
    },
    buildStart() {
      reExports = new Map()

      findReExportFilesPromise.then(files => {
        parsePromise = parseExport(server, reExports, {files, resolve: this.resolve.bind(this)})
      })
    },

    async transform(code, id, _) {
      const files = await findReExportFilesPromise
      if (files.find(file => id === file)) {
        return null
      }

      await parsePromise
      return expandImport(code, reExports, {id, resolve: this.resolve.bind(this)})
    }
  } as Plugin
}

async function findReExportFiles({ root, patterns, ignore }: ShakenPluginParams) {
  const files = await fg(patterns, { cwd: root, ignore })
  const reExportFiles: string[] = []

  await Promise.allSettled(files.map(async file => {
    const realPath = join(root, file)
    const code = (await readFile(realPath)).toString()

    parse(code)[2] && reExportFiles.push(realPath)
  }))

  return reExportFiles
}

async function parseExport(server: ViteDevServer, reExports: ReExportMap,  {files, resolve}: {files: string[],  resolve: Rollup.PluginContext['resolve']}) {
  return Promise.allSettled(files.map(file => server.transformRequest(file).then(async ({ code }) => {
    const [imports, exports] = parse(code)
    const exportData: Record<string, ReExportData> = {}
    console.log(imports, exports)
    await Promise.all(imports.map(async it => {
      const st = code.slice(it.ss, it.se)
      // @ts-expect-error
      it.st = st
      const m = st.match(exportAllRE)
        if(m?.length) {
          if(m[2]) {
            exportData[m[2]] = {from: it.n, as: m[2], name: '*'}
          } else {
            const id =(await resolve(it.n, file))?.id
            const [,deepExports] = parse((await readFile(id)).toString())
            deepExports.forEach(({ln, n}) => {
              exportData[n] = {from: it.n, as: n, name: ln}
            })
          }
        }
    }))

    exports.forEach(({ s, e, n, ln }) => {
      // @ts-expect-error
      imports.forEach(({ n: from, ss, se, st }) => {
        if (!exportData[n] && ((s >= ss && e <= se) || st.match(ln ?? n)?.length)) {
          exportData[n] = {
            from,
            as: n,
            name: st.includes('*') ? '*' : ln ? ln : st.includes(`default as ${n}`) ? 'default' : ln
          }
          return
        }
      })
    })
    reExports.set(file, { code, exports: Object.values(exportData).reduce((acc, et) => {
      const {from} = et
      acc[from] ??= []
      acc[from].push(et)
      return acc
    }, {})})
  })))
}

async function expandImport(code: string, reExport: ReExportMap, {id, resolve}: {id: string, resolve: Rollup.PluginContext['resolve']}) {
  const [imports] = parse(code)
  const exportArr = (await Promise.all(imports.map(async ({ n, ss, se }) => {
    const file = n ? (await resolve(n, id))?.id : ''
    if (reExport.has(file)) {
      const { exports } = reExport.get(file)
      const st = code.slice(ss, se)
      return {ss, se, exports: Object.values(exports).map(ets =>  ets.filter(et => st.includes(et.as)))}
    }
  }))).filter(ets => Boolean(ets))

  if(exportArr.length) {
    let s = new MagicString(code)
    exportArr.forEach(({ss, se, exports}) => {
      console.log(exports)
        const importStatements = exports.reduce((importStatements, ets) => {
          let importStatement = ''
          if(ets[0].name === '*') {
            importStatement = `import * ${ets[0].as ? `as ${ets[0].as}` : ''} from "${ets[0].from}"`
          } else {
            importStatement = 'import { ' + ets.reduce((names, {as, name}) => `${name && name !== as ? `${name} as ${as}` : as}, ${names}`, '') +  ` } from "${ets[0].from}"`
          }
  
          return `${importStatement}\n${importStatements}`
        }, '')
        s.overwrite(ss, se, importStatements)
    })

    return {
      code: s.toString()
    }
  }
}