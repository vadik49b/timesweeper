#!/usr/bin/env node

import { addDays, addMinutes, getHours, getMinutes, isValid, lightFormat, parse } from 'date-fns'

const SLOT_MINUTES = 30

const DEFAULTS = {
  baseUrl: 'http://127.0.0.1:8787',
  appUrl: 'http://localhost:5173',
  events: 1,
  participants: 24,
  days: 5,
  start: '09:00',
  end: '18:00',
  maybeRate: 0.18,
  noRate: 0.45,
}

function showHelp() {
  console.log(`Seed local Wrangler API with fake TimeSweeper events.

Usage:
  npm run seed:local -- [options]

Options:
  --base-url <url>        API origin (default: ${DEFAULTS.baseUrl})
  --app-url <url>         App origin for printed links (default: ${DEFAULTS.appUrl})
  --events <n>            Number of events to create (default: ${DEFAULTS.events})
  --participants <n>      Participants per event (default: ${DEFAULTS.participants})
  --days <n>              Number of dates per event (default: ${DEFAULTS.days})
  --start <HH:MM>         Start time, 24h (default: ${DEFAULTS.start})
  --end <HH:MM>           End time, 24h (default: ${DEFAULTS.end})
  --maybe-rate <0..1>     Maybe probability (default: ${DEFAULTS.maybeRate})
  --no-rate <0..1>        No probability (default: ${DEFAULTS.noRate})
  --help                  Show this help

Examples:
  npm run seed:local -- --events 3 --participants 40
  npm run seed:local -- --base-url http://127.0.0.1:8787 --days 7
`)
}

function parseArgs(argv) {
  const config = { ...DEFAULTS }
  let i = 0

  while (i < argv.length) {
    const arg = argv[i]

    if (arg === '--help') {
      config.help = true
      i += 1
      continue
    }

    const next = argv[i + 1]

    if (!next) {
      throw new Error(`Missing value for ${arg}`)
    }

    if (arg === '--base-url') {
      config.baseUrl = next
    } else if (arg === '--app-url') {
      config.appUrl = next
    } else if (arg === '--events') {
      config.events = Number(next)
    } else if (arg === '--participants') {
      config.participants = Number(next)
    } else if (arg === '--days') {
      config.days = Number(next)
    } else if (arg === '--start') {
      config.start = next
    } else if (arg === '--end') {
      config.end = next
    } else if (arg === '--maybe-rate') {
      config.maybeRate = Number(next)
    } else if (arg === '--no-rate') {
      config.noRate = Number(next)
    } else {
      throw new Error(`Unknown arg: ${arg}`)
    }

    i += 2
  }

  return config
}

function validateConfig(config) {
  if (!Number.isInteger(config.events) || config.events < 1) {
    throw new Error('--events must be an integer >= 1')
  }

  if (!Number.isInteger(config.participants) || config.participants < 1) {
    throw new Error('--participants must be an integer >= 1')
  }

  if (!Number.isInteger(config.days) || config.days < 1 || config.days > 14) {
    throw new Error('--days must be an integer between 1 and 14')
  }

  if (config.maybeRate < 0 || config.maybeRate > 1) {
    throw new Error('--maybe-rate must be in [0, 1]')
  }

  if (config.noRate < 0 || config.noRate > 1) {
    throw new Error('--no-rate must be in [0, 1]')
  }

  if (config.noRate + config.maybeRate > 1) {
    throw new Error('--no-rate + --maybe-rate must be <= 1')
  }
}

function parseTimeToMinutes(hhmm) {
  const parsed = parse(hhmm, 'HH:mm', new Date(2000, 0, 1))

  if (!isValid(parsed) || lightFormat(parsed, 'HH:mm') !== hhmm) {
    throw new Error(`Invalid time format: ${hhmm}`)
  }

  return getHours(parsed) * 60 + getMinutes(parsed)
}

function buildDates(days) {
  const out = []
  const start = new Date()
  start.setHours(0, 0, 0, 0)

  for (let i = 0; i < days; i += 1) {
    out.push(lightFormat(addDays(start, i), 'yyyy-MM-dd'))
  }

  return out
}

function buildSlotStartsUtcIso(dates, startMins, endMins) {
  const slots = []

  for (const dateKey of dates) {
    const dayStart = parse(dateKey, 'yyyy-MM-dd', new Date())

    for (let minute = startMins; minute < endMins; minute += SLOT_MINUTES) {
      slots.push(addMinutes(dayStart, minute).toISOString())
    }
  }

  return slots
}

function randomChoice(noRate, maybeRate) {
  const r = Math.random()

  if (r < noRate) {
    return 0
  }

  if (r < noRate + maybeRate) {
    return 2
  }

  return 1
}

function makeName(index) {
  const first = [
    'Alex',
    'Sam',
    'Jordan',
    'Taylor',
    'Casey',
    'Morgan',
    'Avery',
    'Riley',
    'Jamie',
    'Cameron',
    'Chris',
    'Drew',
  ]
  const last = [
    'Lee',
    'Kim',
    'Patel',
    'Garcia',
    'Brown',
    'Davis',
    'Nguyen',
    'Smith',
    'Wilson',
    'Clark',
    'Jones',
    'Young',
  ]

  const f = first[index % first.length]
  const l = last[Math.floor(index / first.length) % last.length]
  const suffix = Math.floor(index / (first.length * last.length))

  if (suffix === 0) {
    return `${f} ${l}`
  }

  return `${f} ${l} ${suffix + 1}`
}

function buildParticipant(name, slotStartsUtcIso, noRate, maybeRate) {
  const slots = {}

  for (const slotStartUtcIso of slotStartsUtcIso) {
    const value = randomChoice(noRate, maybeRate)

    if (value > 0) {
      slots[slotStartUtcIso] = value
    }
  }

  return {
    name,
    slots,
  }
}

function randomId() {
  return `seed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeBaseUrl(url) {
  return url.endsWith('/') ? url.slice(0, -1) : url
}

async function putEvent(baseUrl, event) {
  const response = await fetch(`${baseUrl}/api/events/${encodeURIComponent(event.id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`PUT /api/events/${event.id} failed (${response.status}): ${body}`)
  }
}

async function main() {
  const config = parseArgs(process.argv.slice(2))

  if (config.help) {
    showHelp()

    return
  }

  validateConfig(config)

  const startMins = parseTimeToMinutes(config.start)
  const endMins = parseTimeToMinutes(config.end)

  if (endMins <= startMins) {
    throw new Error('--end must be later than --start')
  }

  if ((endMins - startMins) % SLOT_MINUTES !== 0) {
    throw new Error('Time range must align with 30-minute slots')
  }

  const dates = buildDates(config.days)
  const slotStartsUtcIso = buildSlotStartsUtcIso(dates, startMins, endMins)
  const baseUrl = normalizeBaseUrl(config.baseUrl)
  const appUrl = normalizeBaseUrl(config.appUrl)
  const created = []

  for (let eventIndex = 0; eventIndex < config.events; eventIndex += 1) {
    const id = randomId()
    const participants = []

    for (let personIndex = 0; personIndex < config.participants; personIndex += 1) {
      const personName = makeName(eventIndex * config.participants + personIndex)
      participants.push(
        buildParticipant(personName, slotStartsUtcIso, config.noRate, config.maybeRate),
      )
    }

    const event = {
      id,
      name: `Load Test Event ${eventIndex + 1}`,
      created: Date.now(),
      slotStartsUtcIso,
      participants,
    }

    await putEvent(baseUrl, event)

    created.push(event)
  }

  console.log(
    `Seeded ${created.length} event(s) on ${baseUrl} with ${config.participants} participants each.`,
  )

  for (const event of created) {
    console.log(`- ${event.name}`)
    console.log(`  API: ${baseUrl}/api/events/${event.id}`)
    console.log(`  APP: ${appUrl}/e/${event.id}`)
  }
}

main().catch((error) => {
  console.error(`Seed failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
