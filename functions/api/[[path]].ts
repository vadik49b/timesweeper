const WORKER_URL = 'https://timesweeper-api.boltach.workers.dev'

export const onRequest: PagesFunction = async (ctx) => {
  const url = new URL(ctx.request.url)
  const targetUrl = `${WORKER_URL}${url.pathname}${url.search}`

  const upgradeHeader = ctx.request.headers.get('Upgrade')
  if (upgradeHeader === 'websocket') {
    return fetch(targetUrl, ctx.request)
  }

  return fetch(new Request(targetUrl, ctx.request))
}
