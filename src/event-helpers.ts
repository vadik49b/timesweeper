import {
  getDate,
  getHours,
  getMinutes,
  getMonth,
  getYear,
  intlFormat,
  isValid,
  lightFormat,
  parse,
  parseISO,
} from 'date-fns'

export const SLOT_DURATION = 30

export type SlotValue = 0 | 1 | 2

export interface SlotGenerationInput {
  dates: string[]
  slotMinutes: number
  windowStartMin: number
  windowEndMin: number
  timezone: string
}

export interface ParticipantSummaryGroups {
  yes: string[]
  maybe: string[]
  no: string[]
}

export interface ParticipantStatusRow {
  value: SlotValue
  names: string[]
  label: 'yes' | 'maybe' | 'no'
}

export type SlotMap = Record<string, SlotValue>

export interface Participant {
  name: string
  slots: SlotMap
}

export interface DisplayDay {
  key: string
  label: string
}

export interface DisplayTime {
  key: string
  label: string
  minutes: number
}

export interface DisplaySlot {
  slotIndex: number
  startUtcIso: string
  dayKey: string
  dayLabel: string
  timeKey: string
  timeLabel: string
}

export interface DisplayModel {
  slots: DisplaySlot[]
  days: DisplayDay[]
  times: DisplayTime[]
  slotByDayTime: Record<string, DisplaySlot | undefined>
}

export interface AppEvent {
  id: string
  name: string
  created: number
  slotStartsUtcIso: string[]
  participants: Participant[]
}

type ZonedDateTimeParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const zonedDateTimeFormatters = new Map<string, Intl.DateTimeFormat>()

function getZonedDateTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  const existing = zonedDateTimeFormatters.get(timeZone)

  if (existing) {
    return existing
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })

  zonedDateTimeFormatters.set(timeZone, formatter)

  return formatter
}

function parseDateKey(dateKey: string): { year: number; month: number; day: number } | null {
  const parsed = parse(dateKey, 'yyyy-MM-dd', new Date())

  if (!isValid(parsed) || lightFormat(parsed, 'yyyy-MM-dd') !== dateKey) {
    return null
  }

  return {
    year: getYear(parsed),
    month: getMonth(parsed) + 1,
    day: getDate(parsed),
  }
}

function toUtcCivilMs(parts: ZonedDateTimeParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0)
}

function getZonedDateTimeParts(utcMs: number, timeZone: string): ZonedDateTimeParts {
  const formatter = getZonedDateTimeFormatter(timeZone)
  const parts = formatter.formatToParts(new Date(utcMs))
  const values: Partial<ZonedDateTimeParts> = {}

  parts.forEach((part) => {
    if (
      part.type === 'year' ||
      part.type === 'month' ||
      part.type === 'day' ||
      part.type === 'hour' ||
      part.type === 'minute' ||
      part.type === 'second'
    ) {
      values[part.type] = Number(part.value)
    }
  })

  return {
    year: values.year ?? 0,
    month: values.month ?? 1,
    day: values.day ?? 1,
    hour: values.hour ?? 0,
    minute: values.minute ?? 0,
    second: values.second ?? 0,
  }
}

function zonedDateTimeToUtcMs(dateKey: string, minutes: number, timeZone: string): number | null {
  const parsed = parseDateKey(dateKey)

  if (!parsed) {
    return null
  }

  const desired: ZonedDateTimeParts = {
    year: parsed.year,
    month: parsed.month,
    day: parsed.day,
    hour: Math.floor(minutes / 60),
    minute: minutes % 60,
    second: 0,
  }

  let utcMs = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
    desired.second,
    0,
  )

  for (let i = 0; i < 4; i += 1) {
    const actual = getZonedDateTimeParts(utcMs, timeZone)
    const diffMs = toUtcCivilMs(desired) - toUtcCivilMs(actual)

    if (diffMs === 0) {
      return utcMs
    }

    utcMs += diffMs
  }

  return utcMs
}

export function parseTimeStringToMinutes(value: string): number | null {
  const parsed = parse(value, 'HH:mm', new Date(2000, 0, 1))

  if (!isValid(parsed) || lightFormat(parsed, 'HH:mm') !== value) {
    return null
  }

  return getHours(parsed) * 60 + getMinutes(parsed)
}

export function getSlotsPerDay(
  input: Pick<SlotGenerationInput, 'slotMinutes' | 'windowStartMin' | 'windowEndMin'>,
): number {
  if (input.slotMinutes <= 0) {
    return 0
  }

  const duration = input.windowEndMin - input.windowStartMin

  if (duration <= 0 || duration % input.slotMinutes !== 0) {
    return 0
  }

  return duration / input.slotMinutes
}

export function buildSlotStartsUtcIso(input: SlotGenerationInput): string[] {
  const slots: string[] = []
  const slotsPerDay = getSlotsPerDay(input)

  input.dates.forEach((dateKey) => {
    for (let offset = 0; offset < slotsPerDay; offset += 1) {
      const minute = input.windowStartMin + offset * input.slotMinutes
      const startUtcMs = zonedDateTimeToUtcMs(dateKey, minute, input.timezone)

      if (startUtcMs === null) {
        continue
      }

      slots.push(new Date(startUtcMs).toISOString())
    }
  })

  return slots
}

export function getEventSlotCount(event: Pick<AppEvent, 'slotStartsUtcIso'>): number {
  return event.slotStartsUtcIso.length
}

export function getParticipantSlotValue(
  participant: Pick<Participant, 'slots'> | null | undefined,
  slotStartUtcIso: string,
): SlotValue {
  return (participant?.slots[slotStartUtcIso] ?? 0) as SlotValue
}

export function hasParticipantAvailability(participant: Pick<Participant, 'slots'>): boolean {
  return Object.keys(participant.slots).length > 0
}

export function getNameKey(name: string): string {
  return name.trim().toLowerCase()
}

export function findDuplicateName(names: string[], reservedNames: string[] = []): string | null {
  const seen = new Set(reservedNames.map(getNameKey))

  for (const name of names) {
    const trimmed = name.trim()

    if (!trimmed) {
      continue
    }

    if (seen.has(getNameKey(trimmed))) {
      return trimmed
    }

    seen.add(getNameKey(trimmed))
  }

  return null
}

export function getOrderedParticipants(
  participants: Participant[],
  currentName: string,
): Participant[] {
  return [...participants].sort((a, b) => {
    if (a.name === currentName) {
      return -1
    }

    if (b.name === currentName) {
      return 1
    }

    return a.name.localeCompare(b.name)
  })
}

export function emptyParticipantSummaryGroups(): ParticipantSummaryGroups {
  return {
    yes: [],
    maybe: [],
    no: [],
  }
}

export function getParticipantSummaryGroups(
  event: Pick<AppEvent, 'participants'>,
  currentName: string,
  slotStartUtcIso: string,
): ParticipantSummaryGroups {
  const groups = emptyParticipantSummaryGroups()

  getOrderedParticipants(event.participants, currentName).forEach((participant) => {
    const value = getParticipantSlotValue(participant, slotStartUtcIso)
    const displayName = participant.name === currentName ? 'You' : participant.name

    if (value === 1) {
      groups.yes.push(displayName)

      return
    }

    if (value === 2) {
      groups.maybe.push(displayName)

      return
    }

    groups.no.push(displayName)
  })

  return groups
}

export function buildDisplayModel(slotStartsUtcIso: string[]): DisplayModel {
  const slots: DisplaySlot[] = []
  const dayMap = new Map<string, DisplayDay>()
  const timeMap = new Map<string, DisplayTime>()
  const slotByDayTime: DisplayModel['slotByDayTime'] = {}

  slotStartsUtcIso.forEach((slotStartUtcIso, slotIndex) => {
    const date = parseISO(slotStartUtcIso)
    const dayKey = lightFormat(date, 'yyyy-MM-dd')
    const dayLabel = intlFormat(date, {
      weekday: 'short',
      day: 'numeric',
    })
    const timeKey = lightFormat(date, 'HH:mm')
    const timeLabel = intlFormat(date, {
      hour: 'numeric',
      minute: '2-digit',
    })
    const slot = {
      slotIndex,
      startUtcIso: slotStartUtcIso,
      dayKey,
      dayLabel,
      timeKey,
      timeLabel,
    }

    slots.push(slot)
    dayMap.set(dayKey, {
      key: dayKey,
      label: dayLabel,
    })
    timeMap.set(timeKey, {
      key: timeKey,
      label: timeLabel,
      minutes: getHours(date) * 60 + getMinutes(date),
    })
    slotByDayTime[`${dayKey}|${timeKey}`] = slot
  })

  return {
    slots,
    days: [...dayMap.values()].sort((a, b) => a.key.localeCompare(b.key)),
    times: [...timeMap.values()].sort((a, b) => {
      if (a.minutes !== b.minutes) {
        return a.minutes - b.minutes
      }

      return a.key.localeCompare(b.key)
    }),
    slotByDayTime,
  }
}

export function participantStatusRows(groups: ParticipantSummaryGroups): ParticipantStatusRow[] {
  return [
    { value: 1 as SlotValue, names: groups.yes, label: 'yes' as const },
    { value: 2 as SlotValue, names: groups.maybe, label: 'maybe' as const },
    { value: 0 as SlotValue, names: groups.no, label: 'no' as const },
  ].filter((group) => group.names.length > 0)
}

export function participantStatusSummary(groups: ParticipantSummaryGroups): string {
  return participantStatusRows(groups)
    .map((group) => `${group.names.length} ${group.label}`)
    .join(', ')
}
