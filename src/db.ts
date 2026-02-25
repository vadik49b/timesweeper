import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { AppEvent, SlotValue } from './types'

interface TimeSweeper extends DBSchema {
  events: {
    key: string
    value: AppEvent
    indexes: { 'by-created': number }
  }
}

let dbp: Promise<IDBPDatabase<TimeSweeper>> | null = null

function getDB() {
  if (!dbp) {
    dbp = openDB<TimeSweeper>('timesweeper', 1, {
      upgrade(db) {
        const store = db.createObjectStore('events', { keyPath: 'id' })
        store.createIndex('by-created', 'created')
      },
    })
  }
  return dbp
}

export async function saveEvent(event: AppEvent): Promise<void> {
  const db = await getDB()
  await db.put('events', event)
}

export async function getEvent(id: string): Promise<AppEvent | undefined> {
  const db = await getDB()
  return db.get('events', id)
}

export async function listEvents(): Promise<AppEvent[]> {
  const db = await getDB()
  const all = await db.getAllFromIndex('events', 'by-created')
  return all.reverse()
}

export async function updateParticipantSlots(
  eventId: string,
  name: string,
  slots: SlotValue[],
  updatedAt: number,
): Promise<void> {
  const db = await getDB()
  const event = await db.get('events', eventId)
  if (!event) return
  const idx = event.participants.findIndex((p) => p.name === name)
  if (idx !== -1) {
    event.participants[idx] = { ...event.participants[idx], slots, updatedAt }
  }
  await db.put('events', event)
}
