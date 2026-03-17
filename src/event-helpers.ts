export const SLOT_DURATION = 30

export type SlotValue = 0 | 1 | 2

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

export interface Participant {
  name: string
  slots: SlotValue[]
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
  dayKey: string
  dayLabel: string
  timeKey: string
  timeLabel: string
}

export interface AvailabilityGridModel {
  days: DisplayDay[]
  times: DisplayTime[]
  slots: DisplaySlot[]
  slotIndexByDayAndTime: Record<string, Record<string, number>>
}

export interface AppEvent {
  id: string
  name: string
  created: number
  status: 'open' | 'confirmed'
  confirmedBy?: string
  confirmedSlotIndex?: number
  slotStartsUtc: number[]
  participants: Participant[]
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function localDayKeyFromDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function localTimeKeyFromDate(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

export function getSlotEndUtcMs(startUtcMs: number): number {
  return startUtcMs + SLOT_DURATION * 60_000
}

export function formatSlotDayLabel(startUtcMs: number): string {
  const date = new Date(startUtcMs)
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()]

  return `${dow} ${date.getDate()}`
}

export function formatSlotFullDayLabel(startUtcMs: number): string {
  return new Date(startUtcMs).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatSlotLongDayLabel(startUtcMs: number): string {
  return new Date(startUtcMs).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

export function formatSlotTimeLabel(startUtcMs: number): string {
  return new Date(startUtcMs).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function getDisplaySlot(startUtcMs: number, slotIndex: number): DisplaySlot {
  const date = new Date(startUtcMs)

  return {
    slotIndex,
    dayKey: localDayKeyFromDate(date),
    dayLabel: formatSlotDayLabel(startUtcMs),
    timeKey: localTimeKeyFromDate(date),
    timeLabel: formatSlotTimeLabel(startUtcMs),
  }
}

export function buildAvailabilityGridModel(slotStartsUtc: number[]): AvailabilityGridModel {
  const dayMap = new Map<string, DisplayDay>()
  const timeMap = new Map<string, DisplayTime>()
  const slots: DisplaySlot[] = []
  const slotIndexByDayAndTime: Record<string, Record<string, number>> = {}

  slotStartsUtc.forEach((startUtcMs, slotIndex) => {
    const displaySlot = getDisplaySlot(startUtcMs, slotIndex)
    const date = new Date(startUtcMs)

    dayMap.set(displaySlot.dayKey, {
      key: displaySlot.dayKey,
      label: displaySlot.dayLabel,
    })
    timeMap.set(displaySlot.timeKey, {
      key: displaySlot.timeKey,
      label: displaySlot.timeLabel,
      minutes: date.getHours() * 60 + date.getMinutes(),
    })
    slotIndexByDayAndTime[displaySlot.dayKey] ??= {}
    slotIndexByDayAndTime[displaySlot.dayKey][displaySlot.timeKey] = slotIndex
    slots.push(displaySlot)
  })

  return {
    days: [...dayMap.values()].sort((a, b) => a.key.localeCompare(b.key)),
    times: [...timeMap.values()].sort((a, b) => {
      if (a.minutes !== b.minutes) {
        return a.minutes - b.minutes
      }

      return a.key.localeCompare(b.key)
    }),
    slots,
    slotIndexByDayAndTime,
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
