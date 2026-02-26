export const SLOT_DURATION = 30

export type SlotValue = 0 | 1 | 2

export interface Participant {
  name: string
  timezone: string
  slots: SlotValue[]
  visitedAt: number | null
  updatedAt: number | null
}

export interface ConfirmedSlot {
  date: string
  startTime: string
  endTime: string
}

export interface AppEvent {
  id: string
  name: string
  created: number
  status: 'open' | 'confirmed'
  maxParticipants: number
  confirmedSlot?: ConfirmedSlot
  dates: string[]
  timeRange: { start: string; end: string }
  participants: Participant[]
}

export function slotsPerDay(event: AppEvent): number {
  const [sh, sm] = event.timeRange.start.split(':').map(Number)
  const [eh, em] = event.timeRange.end.split(':').map(Number)
  return (eh * 60 + em - (sh * 60 + sm)) / SLOT_DURATION
}

export function computeTimeSlots(timeRange: {
  start: string
  end: string
}): { label: string; value: string }[] {
  const [sh, sm] = timeRange.start.split(':').map(Number)
  const [eh, em] = timeRange.end.split(':').map(Number)
  const startMins = sh * 60 + sm
  const endMins = eh * 60 + em
  const out: { label: string; value: string }[] = []
  for (let m = startMins; m < endMins; m += SLOT_DURATION) {
    const h = Math.floor(m / 60)
    const min = m % 60
    const hh = h % 12 || 12
    const mm = String(min).padStart(2, '0')
    out.push({ label: `${hh}:${mm}`, value: `${String(h).padStart(2, '0')}:${mm}` })
  }
  return out
}

export function formatDateLabel(ds: string): string {
  const [y, m, d] = ds.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getDay()]
  return `${dow} ${d}`
}

export function flatToRecord(
  slots: SlotValue[],
  dates: string[],
  spd: number,
): Record<string, number[]> {
  const record: Record<string, number[]> = {}
  dates.forEach((ds, di) => {
    record[ds] = Array.from({ length: spd }, (_, ti) => slots[di * spd + ti] ?? 0)
  })
  return record
}

export function recordToFlat(
  record: Record<string, number[]>,
  dates: string[],
  spd: number,
): SlotValue[] {
  const flat: SlotValue[] = new Array(dates.length * spd).fill(0)
  dates.forEach((ds, di) => {
    const day = record[ds] ?? []
    for (let ti = 0; ti < spd; ti++) {
      flat[di * spd + ti] = (day[ti] ?? 0) as SlotValue
    }
  })
  return flat
}
