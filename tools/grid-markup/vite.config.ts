import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import crypto from 'crypto'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '../..')
const DATA = resolve(ROOT, 'data/uex')
const FACES = resolve(DATA, 'grid-faces.json')
const HASHES = resolve(DATA, 'hashes.json')

// dev endpoint: GET the faces, POST writes grid-faces.json and rehashes
function facesIo() {
  return {
    name: 'grid-faces-io',
    configureServer(server: { middlewares: { use: (path: string, fn: unknown) => void } }) {
      server.middlewares.use('/api/faces', (req: any, res: any, next: () => void) => {
        if (req.method === 'GET') {
          try {
            const doc = JSON.parse(fs.readFileSync(FACES, 'utf8'))
            res.setHeader('content-type', 'application/json')
            return res.end(JSON.stringify(doc.gridFaces ?? []))
          } catch {
            res.statusCode = 500
            return res.end('[]')
          }
        }
        if (req.method === 'POST') {
          let body = ''
          req.on('data', (c: Buffer) => (body += c))
          req.on('end', () => {
            try {
              const faces = JSON.parse(body)
              const cur = JSON.parse(fs.readFileSync(FACES, 'utf8'))
              const doc = {
                source: cur.source,
                syncedAt: new Date().toISOString().slice(0, 10),
                gridFaces: faces
              }
              const json = JSON.stringify(doc, null, 2) + '\n'
              fs.writeFileSync(FACES, json)
              const h = JSON.parse(fs.readFileSync(HASHES, 'utf8'))
              h.gridFaces = crypto.createHash('sha256').update(json).digest('hex')
              fs.writeFileSync(HASHES, JSON.stringify(h, null, 2) + '\n')
              res.setHeader('content-type', 'application/json')
              res.end(JSON.stringify({ ok: true, hash: h.gridFaces, count: faces.length }))
            } catch (e) {
              res.statusCode = 500
              res.end(JSON.stringify({ ok: false, error: String(e) }))
            }
          })
          return
        }
        next()
      })
    }
  }
}

export default defineConfig({
  root: here,
  resolve: { alias: { '@shared': resolve(ROOT, 'src/shared') } },
  plugins: [react(), facesIo()],
  server: { port: 5311, open: true }
})
