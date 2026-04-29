#!/usr/bin/env node

import { addDays, addMinutes, getHours, getMinutes, isValid, lightFormat, parse } from 'date-fns'
import { nanoid } from 'nanoid'
import { createMergeableStore } from 'tinybase/mergeable-store'
import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client'
import {
  AVAILABILITY_TABLE,
  EVENT_META_CREATED_CELL,
  EVENT_META_TABLE,
  EVENT_META_NAME_CELL,
  EVENT_META_PARTICIPANT_NAMES_CELL,
  EVENT_META_SLOT_STARTS_UTC_ISO_CELL,
} from '../shared/tinybase-schema.ts'

const SLOT_MINUTES = 30
const SYNC_STATUS_IDLE = 0
const SYNC_STATUS_SAVING = 2

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

interface SeedConfig {
  baseUrl: string
  appUrl: string
  events: number
  participants: number
  days: number
  start: string
  end: string
  maybeRate: number
  noRate: number
  help?: boolean
}

interface SeedParticipant {
  name: string
  slots: Record<string, 1 | 2>
}

interface SeedEvent {
  id: string
  name: string
  created: number
  slotStartsUtcIso: string[]
  participants: SeedParticipant[]
}

type EventSynchronizer = Awaited<ReturnType<typeof createWsSynchronizer>>

function showHelp() {
  console.log(`Seed local Wrangler Durable Object rooms with fake TimeSweeper events.

Usage:
  npm run seed:local -- [options]

Options:
  --base-url <url>        Worker origin for WebSocket sync (default: ${DEFAULTS.baseUrl})
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

function parseArgs(argv: string[]): SeedConfig {
  const config: SeedConfig = { ...DEFAULTS }
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

function validateConfig(config: SeedConfig): void {
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

function parseTimeToMinutes(hhmm: string): number {
  const parsed = parse(hhmm, 'HH:mm', new Date(2000, 0, 1))

  if (!isValid(parsed) || lightFormat(parsed, 'HH:mm') !== hhmm) {
    throw new Error(`Invalid time format: ${hhmm}`)
  }

  return getHours(parsed) * 60 + getMinutes(parsed)
}

function buildDates(days: number): string[] {
  const out: string[] = []
  const start = new Date()
  start.setHours(0, 0, 0, 0)

  for (let i = 0; i < days; i += 1) {
    out.push(lightFormat(addDays(start, i), 'yyyy-MM-dd'))
  }

  return out
}

function buildSlotStartsUtcIso(dates: string[], startMins: number, endMins: number): string[] {
  const slots: string[] = []

  for (const dateKey of dates) {
    const dayStart = parse(dateKey, 'yyyy-MM-dd', new Date())

    for (let minute = startMins; minute < endMins; minute += SLOT_MINUTES) {
      slots.push(addMinutes(dayStart, minute).toISOString())
    }
  }

  return slots
}

function randomChoice(noRate: number, maybeRate: number): 0 | 1 | 2 {
  const r = Math.random()

  if (r < noRate) {
    return 0
  }

  if (r < noRate + maybeRate) {
    return 2
  }

  return 1
}

function makeName(index: number): string {
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

function buildParticipant(
  name: string,
  slotStartsUtcIso: string[],
  noRate: number,
  maybeRate: number,
): SeedParticipant {
  const slots: Record<string, 1 | 2> = {}

  for (const slotStartUtcIso of slotStartsUtcIso) {
    const value = randomChoice(noRate, maybeRate)

    if (value !== 0) {
      slots[slotStartUtcIso] = value
    }
  }

  return {
    name,
    slots,
  }
}

function normalizeBaseUrl(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}

function eventSyncUrl(baseUrl: string, eventId: string): string {
  const url = new URL(normalizeBaseUrl(baseUrl))

  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.pathname = `/api/events/${encodeURIComponent(eventId)}`

  return url.toString()
}

function buildSeedTables(event: SeedEvent) {
  const eventMetaRow = {
    [EVENT_META_NAME_CELL]: event.name,
    [EVENT_META_CREATED_CELL]: event.created,
    [EVENT_META_SLOT_STARTS_UTC_ISO_CELL]: event.slotStartsUtcIso,
    [EVENT_META_PARTICIPANT_NAMES_CELL]: event.participants.map((participant) => participant.name),
  }
  const availabilityRows: Record<string, Record<string, 1 | 2>> = {}

  for (const participant of event.participants) {
    if (Object.keys(participant.slots).length > 0) {
      availabilityRows[participant.name] = participant.slots
    }
  }

  return {
    [EVENT_META_TABLE]: {
      [event.id]: eventMetaRow,
    },
    [AVAILABILITY_TABLE]: availabilityRows,
  }
}

async function waitForIdle(synchronizer: EventSynchronizer, timeoutMs = 5_000): Promise<void> {
  if (synchronizer.getStatus() === SYNC_STATUS_IDLE) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      synchronizer.delListener(listenerId)
      reject(new Error(`Sync did not become idle within ${timeoutMs}ms`))
    }, timeoutMs)
    const listenerId = synchronizer.addStatusListener((_synchronizer, status) => {
      if (status === SYNC_STATUS_IDLE) {
        clearTimeout(timeoutId)
        synchronizer.delListener(listenerId)
        resolve()
      }
    })
  })
}

async function waitForSave(synchronizer: EventSynchronizer, timeoutMs = 5_000): Promise<void> {
  if (synchronizer.getStatus() === SYNC_STATUS_SAVING) {
    await waitForIdle(synchronizer, timeoutMs)
    return
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      synchronizer.delListener(listenerId)
      reject(new Error(`Sync did not save within ${timeoutMs}ms`))
    }, timeoutMs)
    const listenerId = synchronizer.addStatusListener((_synchronizer, status) => {
      if (status === SYNC_STATUS_SAVING) {
        clearTimeout(timeoutId)
        synchronizer.delListener(listenerId)
        waitForIdle(synchronizer, timeoutMs).then(resolve, reject)
      }
    })
  })
}

async function seedEvent(baseUrl: string, event: SeedEvent): Promise<void> {
  const store = createMergeableStore()
  const webSocket = new WebSocket(eventSyncUrl(baseUrl, event.id))
  const synchronizer = await createWsSynchronizer(store, webSocket)

  try {
    await synchronizer.startSync()
    await waitForIdle(synchronizer)
    store.setTables(buildSeedTables(event))
    await waitForSave(synchronizer)
  } finally {
    await synchronizer.destroy()
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
  const created: SeedEvent[] = []

  for (let eventIndex = 0; eventIndex < config.events; eventIndex += 1) {
    const id = `seed-${nanoid()}`
    const participants: SeedParticipant[] = []

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

    await seedEvent(baseUrl, event)

    created.push(event)
  }

  console.log(`Seeded ${created.length} event(s) over TinyBase WS on ${baseUrl}.`)
  console.log(
    `Each event has ${config.participants} participants and ${slotStartsUtcIso.length} slots.`,
  )

  for (const event of created) {
    console.log(`- ${event.name}`)
    console.log(`  Open: ${appUrl}/e/${event.id}`)
    console.log(`  WS:  ${eventSyncUrl(baseUrl, event.id)}`)
  }
}

main().catch((error) => {
  console.error(`Seed failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
