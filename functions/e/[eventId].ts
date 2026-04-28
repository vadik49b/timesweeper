interface EventJson {
  name?: unknown
  participants: { name: string }[]
}

export const onRequestGet: PagesFunction = async (context) => {
  const eventId = String(context.params.eventId ?? '')
  const pageUrl = new URL(context.request.url)
  const apiUrl = `https://api.timesweeper.app/api/events/${encodeURIComponent(eventId)}/json`
  const indexRequest = new Request(new URL('/', pageUrl.origin).toString(), context.request)
  const [indexResponse, eventResponse] = await Promise.all([
    context.env.ASSETS.fetch(indexRequest),
    fetch(apiUrl),
  ])

  if (!eventResponse.ok) {
    const headers = new Headers(indexResponse.headers)
    headers.delete('Location')
    headers.set('Cache-Control', 'public, max-age=30')

    return new Response(indexResponse.body, {
      headers,
      status: 200,
    })
  }

  const event = (await eventResponse.json()) as EventJson
  const eventName = typeof event.name === 'string' ? event.name.trim() : ''

  if (!eventName) {
    const headers = new Headers(indexResponse.headers)
    headers.delete('Location')
    headers.set('Cache-Control', 'public, max-age=30')

    return new Response(indexResponse.body, {
      headers,
      status: 200,
    })
  }

  const organizer = event.participants[0].name.trim()
  const title = `${eventName} | TimeSweeper`
  const description = `${organizer} wants to know when you’re free for ${eventName}. Share your availability to help find the best time.`

  const response = new HTMLRewriter()
    .on('title', {
      element(element) {
        element.setInnerContent(title)
      },
    })
    .on('meta[name="description"]', {
      element(element) {
        element.setAttribute('content', description)
      },
    })
    .on('meta[property="og:url"]', {
      element(element) {
        element.setAttribute('content', pageUrl.toString())
      },
    })
    .on('meta[property="og:title"]', {
      element(element) {
        element.setAttribute('content', title)
      },
    })
    .on('meta[property="og:description"]', {
      element(element) {
        element.setAttribute('content', description)
      },
    })
    .on('meta[property="og:image"]', {
      element(element) {
        element.setAttribute('content', `${pageUrl.origin}/anti-tank-mine-logo.png`)
      },
    })
    .on('meta[name="twitter:title"]', {
      element(element) {
        element.setAttribute('content', title)
      },
    })
    .on('meta[name="twitter:description"]', {
      element(element) {
        element.setAttribute('content', description)
      },
    })
    .on('meta[name="twitter:image"]', {
      element(element) {
        element.setAttribute('content', `${pageUrl.origin}/anti-tank-mine-logo.png`)
      },
    })
    .transform(indexResponse)

  const headers = new Headers(response.headers)
  headers.delete('Location')
  headers.set(
    'Cache-Control',
    eventResponse.ok ? 'public, max-age=60, s-maxage=300' : 'public, max-age=30',
  )

  return new Response(response.body, {
    headers,
    status: 200,
  })
}
