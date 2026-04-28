const CACHE_NAME = 'timesweeper-v4'
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/anti-tank-mine-logo.avif',
  '/anti-tank-mine-logo.webp',
  '/anti-tank-mine-logo.png',
]

function extractAssetUrlsFromHtml(html) {
  const matches = html.match(/\/assets\/[^"'`<>\s)]+/g)

  if (!matches) {
    return []
  }

  return Array.from(new Set(matches))
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      await cache.addAll(PRECACHE)

      try {
        const indexResp = await fetch('/index.html', { cache: 'no-cache' })

        if (indexResp.ok) {
          const indexHtml = await indexResp.text()
          const assetUrls = extractAssetUrlsFromHtml(indexHtml)

          if (assetUrls.length > 0) {
            await cache.addAll(assetUrls)
          }
        }
      } catch {
        // Continue install with base precache when network is unavailable.
      }

      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request

  if (req.method !== 'GET') {
    return
  }

  const url = new URL(req.url)

  if (url.origin !== self.location.origin) {
    return
  }

  if (url.pathname.startsWith('/api/')) {
    return
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((resp) => {
          const copy = resp.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy)).catch(() => {})

          return resp
        })
        .catch(async () => {
          const cached = await caches.match('/index.html')

          return cached || caches.match('/')
        }),
    )

    return
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        return cached
      }

      return fetch(req).then((resp) => {
        if (resp.ok) {
          const copy = resp.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {})
        }

        return resp
      })
    }),
  )
})
