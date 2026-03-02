import { createMemo, type Accessor } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import {
  computeTimeSlots,
  flatToRecord,
  formatDateLabel,
  recordToFlat,
  slotsPerDay,
  type AppEvent,
} from '../types'

type UndoEntry = { dk: string; ti: number; prev: number }

interface UseGridStateArgs {
  event: Accessor<AppEvent | null>
  currentName: Accessor<string>
  isConfirmed: Accessor<boolean>
  onSlotsChanged: () => void
}

export function useGridState(args: UseGridStateArgs) {
  const [myState, setMyState] = createStore<Record<string, number[]>>({})
  let undoStack: UndoEntry[][] = []

  const days = createMemo(() => {
    const ev = args.event()
    if (!ev) {
      return []
    }

    return ev.dates.map((ds) => ({ key: ds, label: formatDateLabel(ds) }))
  })

  const times = createMemo(() => {
    const ev = args.event()
    if (!ev) {
      return []
    }

    return computeTimeSlots(ev.timeRange)
  })

  const others = createMemo(() => {
    const ev = args.event()
    if (!ev) return {}
    const cur = args.currentName()
    const spd = slotsPerDay(ev)
    const result: Record<string, Record<string, number[]>> = {}
    ev.participants.forEach((p) => {
      if (p.name === cur) {
        return
      }

      result[p.name] = flatToRecord(p.slots, ev.dates, spd)
    })
    return result
  })

  const participantList = createMemo(() => {
    const ev = args.event()
    if (!ev) {
      return []
    }

    return ev.participants.map((p) => ({ key: p.name, label: p.name }))
  })

  function loadParticipantSlots(ev: AppEvent, name: string) {
    const spd = slotsPerDay(ev)
    const p = ev.participants.find((pp) => pp.name === name)
    if (p) {
      setMyState(reconcile(flatToRecord(p.slots, ev.dates, spd)))
      return
    }
    const empty: Record<string, number[]> = {}
    ev.dates.forEach((ds) => {
      empty[ds] = new Array(spd).fill(0)
    })
    setMyState(reconcile(empty))
  }

  function heat(dk: string, ti: number) {
    let c = 0
    const m = myState[dk]?.[ti] ?? 0
    if (m === 1) {
      c += 1
    } else if (m === 2) {
      c += 0.5
    }

    Object.values(others()).forEach((p) => {
      const v = p[dk]?.[ti] ?? 0
      if (v === 1) {
        c += 1
      } else if (v === 2) {
        c += 0.5
      }
    })
    return Math.round(c)
  }

  const bestTimes = createMemo(() => {
    const d = days()
    const t = times()
    const slots: { day: string; time: string; score: number; dk: string; ti: number }[] = []
    d.forEach((day) =>
      t.forEach((slot, ti) => {
        const h = heat(day.key, ti)
        if (h > 0) slots.push({ day: day.label, time: slot.label, score: h, dk: day.key, ti })
      }),
    )
    slots.sort((a, b) => b.score - a.score)
    return slots.slice(0, 3)
  })

  const totalParticipants = createMemo(() => args.event()?.participants.length ?? 0)
  const participantsWithAvailability = createMemo(() => {
    const ev = args.event()
    if (!ev) {
      return 0
    }

    const spd = slotsPerDay(ev)
    return ev.participants.filter((p) => {
      if (p.name === args.currentName()) {
        return recordToFlat(myState, ev.dates, spd).some((v) => v > 0)
      }
      return p.slots.some((v) => v > 0)
    }).length
  })
  const canShowSuggestions = createMemo(() => participantsWithAvailability() >= 2)

  function cycleCell(dk: string, ti: number) {
    if (args.isConfirmed()) {
      return
    }

    const prev = myState[dk]?.[ti] ?? 0
    const next = (prev + 1) % 3
    if (prev === next) {
      return
    }

    undoStack.push([{ dk, ti, prev }])
    setMyState(dk, ti, next)
    if (navigator.vibrate) navigator.vibrate(10)
    args.onSlotsChanged()
  }

  function doUndo() {
    if (args.isConfirmed()) {
      return
    }

    if (!undoStack.length) {
      return
    }

    const batch = undoStack.pop()!
    batch.forEach((u) => setMyState(u.dk, u.ti, u.prev))
    args.onSlotsChanged()
  }

  const dayCountClass = createMemo(
    () => `grid-table--days-${Math.min(Math.max(days().length, 1), 7)}`,
  )

  const heatmapView = createMemo(() => {
    const d = days()
    const t = times()
    const values = t.map((_, ti) => d.map((day) => heat(day.key, ti)))
    if (d.length === 0 || t.length === 0) return { days: d, times: t, values }

    let minRow = t.length
    let maxRow = -1
    let minCol = d.length
    let maxCol = -1

    values.forEach((row, ri) => {
      row.forEach((value, ci) => {
        if (value <= 0) {
          return
        }

        if (ri < minRow) {
          minRow = ri
        }

        if (ri > maxRow) {
          maxRow = ri
        }

        if (ci < minCol) {
          minCol = ci
        }

        if (ci > maxCol) {
          maxCol = ci
        }
      })
    })

    if (maxRow === -1 || maxCol === -1) return { days: [], times: [], values: [] as number[][] }

    return {
      days: d.slice(minCol, maxCol + 1),
      times: t.slice(minRow, maxRow + 1),
      values: values.slice(minRow, maxRow + 1).map((row) => row.slice(minCol, maxCol + 1)),
    }
  })

  const heatmapDayCountClass = createMemo(
    () => `heatmap-grid--days-${Math.min(Math.max(heatmapView().days.length, 1), 7)}`,
  )
  const confirmDayOptions = createMemo(() =>
    days().map((d) => ({ value: d.label, label: d.label })),
  )
  const confirmTimeOptions = createMemo(() =>
    times().map((t) => ({ value: t.label, label: t.label })),
  )
  const currentLabel = createMemo(
    () => participantList().find((p) => p.key === args.currentName())?.label ?? args.currentName(),
  )

  return {
    myState,
    days,
    times,
    others,
    participantList,
    bestTimes,
    totalParticipants,
    participantsWithAvailability,
    canShowSuggestions,
    dayCountClass,
    heatmapView,
    heatmapDayCountClass,
    confirmDayOptions,
    confirmTimeOptions,
    currentLabel,
    loadParticipantSlots,
    cycleCell,
    doUndo,
  }
}
