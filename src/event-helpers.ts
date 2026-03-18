import { intlFormat, lightFormat } from 'date-fns'

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

export function buildAvailabilityGridModel(slotStartsUtc: number[]): AvailabilityGridModel {
  const dayMap = new Map<string, DisplayDay>()
  const timeMap = new Map<string, DisplayTime>()
  const slots: DisplaySlot[] = []
  const slotIndexByDayAndTime: Record<string, Record<string, number>> = {}

  slotStartsUtc.forEach((startUtcMs, slotIndex) => {
    const date = new Date(startUtcMs)
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
    const displaySlot: DisplaySlot = {
      slotIndex,
      dayKey,
      dayLabel,
      timeKey,
      timeLabel,
    }

    dayMap.set(dayKey, {
      key: dayKey,
      label: dayLabel,
    })
    timeMap.set(timeKey, {
      key: timeKey,
      label: timeLabel,
      minutes: date.getHours() * 60 + date.getMinutes(),
    })
    slotIndexByDayAndTime[dayKey] ??= {}
    slotIndexByDayAndTime[dayKey][timeKey] = slotIndex
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
