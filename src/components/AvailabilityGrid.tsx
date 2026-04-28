import { For, Show, createMemo, createSignal } from 'solid-js'
import type { DisplayDay, DisplaySlot, DisplayTime, SlotMap, SlotValue } from '../event-helpers'

interface DragGesture {
  pointerId: number
  pointerType: string
  startRow: number
  startCol: number
  currentRow: number
  currentCol: number
  originX: number
  originY: number
  targetValue: SlotValue
  painting: boolean
  colLefts: number[]
  rowTops: number[]
  cellWidth: number
  cellHeight: number
  pressTimer: number | null
  latestClientX: number
  latestClientY: number
  autoScrollFrame: number | null
  scrollLocked: boolean
}

interface Props {
  days: DisplayDay[]
  times: DisplayTime[]
  slotByDayTime: Record<string, DisplaySlot | undefined>
  selectedSlots: SlotMap
  onCycle: (slotIndex: number) => void
  onPaint: (slotStartUtcIsos: string[], value: SlotValue) => void | Promise<void>
}

function statusLabel(value: number | undefined): string {
  if (value === 1) {
    return 'yes'
  }

  if (value === 2) {
    return 'maybe'
  }

  return 'no'
}

function nextStatusLabel(value: number | undefined): string {
  if (value === 1) {
    return 'maybe'
  }

  if (value === 2) {
    return 'no'
  }

  return 'yes'
}

export default function AvailabilityGrid(props: Props) {
  let gridRef!: HTMLDivElement
  const cellRefs: HTMLButtonElement[][] = []
  let suppressNextClick = false
  let previousHtmlOverflow = ''
  let previousBodyOverflow = ''
  const preventTouchScroll = (event: TouchEvent) => {
    event.preventDefault()
  }
  const [dragGesture, setDragGesture] = createSignal<DragGesture | null>(null)
  const previewBounds = createMemo(() => {
    const gesture = dragGesture()

    if (!gesture?.painting) {
      return null
    }

    return {
      top: Math.min(gesture.startRow, gesture.currentRow),
      bottom: Math.max(gesture.startRow, gesture.currentRow),
      left: Math.min(gesture.startCol, gesture.currentCol),
      right: Math.max(gesture.startCol, gesture.currentCol),
      targetValue: gesture.targetValue,
    }
  })
  const gridTemplateRows = () =>
    [
      'var(--day-header-height)',
      ...props.times.map((time) =>
        time.gapBefore
          ? 'calc(var(--size-cell) + var(--space-050) + var(--space-050))'
          : 'var(--size-cell)',
      ),
    ].join(' ')
  const previewContains = (row: number, col: number) => {
    const bounds = previewBounds()

    return (
      bounds !== null &&
      row >= bounds.top &&
      row <= bounds.bottom &&
      col >= bounds.left &&
      col <= bounds.right
    )
  }
  const snapIndex = (position: number, starts: number[], size: number) => {
    if (starts.length === 0) {
      return 0
    }

    let closestIndex = 0
    let closestDistance = Number.POSITIVE_INFINITY

    starts.forEach((start, index) => {
      const center = start + size / 2
      const distance = Math.abs(position - center)

      if (distance < closestDistance) {
        closestDistance = distance
        closestIndex = index
      }
    })

    return closestIndex
  }
  const clearDragGesture = () => {
    const gesture = dragGesture()

    if (gesture && gesture.pressTimer !== null) {
      window.clearTimeout(gesture.pressTimer)
    }

    if (gesture && gesture.autoScrollFrame !== null) {
      window.cancelAnimationFrame(gesture.autoScrollFrame)
    }

    if (gesture?.scrollLocked) {
      window.removeEventListener('touchmove', preventTouchScroll)
      document.documentElement.style.overflow = previousHtmlOverflow
      document.body.style.overflow = previousBodyOverflow
    }

    if (gesture && gridRef.hasPointerCapture(gesture.pointerId)) {
      gridRef.releasePointerCapture(gesture.pointerId)
    }

    setDragGesture(null)
  }
  const updateDragTarget = (clientX: number, clientY: number) => {
    const gesture = dragGesture()

    if (!gesture) {
      return
    }

    const gridRect = gridRef.getBoundingClientRect()
    const nextCol = snapIndex(clientX - gridRect.left, gesture.colLefts, gesture.cellWidth)
    const nextRow = snapIndex(clientY - gridRect.top, gesture.rowTops, gesture.cellHeight)

    if (nextCol === gesture.currentCol && nextRow === gesture.currentRow) {
      return
    }

    setDragGesture({
      ...gesture,
      currentCol: nextCol,
      currentRow: nextRow,
    })
  }
  const startAutoScrollLoop = () => {
    const step = () => {
      const gesture = dragGesture()

      if (!gesture?.painting || gesture.pointerType !== 'touch') {
        return
      }

      const edgeThreshold = 56
      const horizontalScrollContainer = gridRef.parentElement
      const topDistance = gesture.latestClientY
      const bottomDistance = window.innerHeight - gesture.latestClientY
      let deltaX = 0
      let deltaY = 0

      if (horizontalScrollContainer) {
        const wrapRect = horizontalScrollContainer.getBoundingClientRect()
        const leftDistance = gesture.latestClientX - wrapRect.left
        const rightDistance = wrapRect.right - gesture.latestClientX

        if (leftDistance < edgeThreshold && horizontalScrollContainer.scrollLeft > 0) {
          deltaX = -Math.ceil(((edgeThreshold - leftDistance) / edgeThreshold) * 18)
        } else if (
          rightDistance < edgeThreshold &&
          horizontalScrollContainer.scrollLeft + horizontalScrollContainer.clientWidth <
            horizontalScrollContainer.scrollWidth
        ) {
          deltaX = Math.ceil(((edgeThreshold - rightDistance) / edgeThreshold) * 18)
        }
      }

      if (topDistance < edgeThreshold) {
        deltaY = -Math.ceil(((edgeThreshold - topDistance) / edgeThreshold) * 18)
      } else if (bottomDistance < edgeThreshold) {
        deltaY = Math.ceil(((edgeThreshold - bottomDistance) / edgeThreshold) * 18)
      }

      if (deltaX !== 0 && horizontalScrollContainer) {
        horizontalScrollContainer.scrollBy(deltaX, 0)
      }

      if (deltaY !== 0) {
        window.scrollBy(0, deltaY)
      }

      if (deltaX !== 0 || deltaY !== 0) {
        updateDragTarget(gesture.latestClientX, gesture.latestClientY)
      }

      const nextFrame = window.requestAnimationFrame(step)

      setDragGesture((current) =>
        current
          ? {
              ...current,
              autoScrollFrame: nextFrame,
            }
          : current,
      )
    }

    const frame = window.requestAnimationFrame(step)

    setDragGesture((current) =>
      current
        ? {
            ...current,
            autoScrollFrame: frame,
          }
        : current,
    )
  }
  const activateTouchPainting = (pointerId: number) => {
    setDragGesture((current) => {
      if (!current || current.pointerId !== pointerId || current.painting) {
        return current
      }

      previousHtmlOverflow = document.documentElement.style.overflow
      previousBodyOverflow = document.body.style.overflow
      document.documentElement.style.overflow = 'hidden'
      document.body.style.overflow = 'hidden'
      window.addEventListener('touchmove', preventTouchScroll, { passive: false })
      gridRef.setPointerCapture(pointerId)

      if (navigator.vibrate) {
        navigator.vibrate(10)
      }

      return {
        ...current,
        painting: true,
        pressTimer: null,
        scrollLocked: true,
      }
    })

    startAutoScrollLoop()
  }
  const finishDragGesture = () => {
    const gesture = dragGesture()

    if (!gesture) {
      return
    }

    if (gridRef.hasPointerCapture(gesture.pointerId)) {
      gridRef.releasePointerCapture(gesture.pointerId)
    }

    if (gesture.pressTimer !== null) {
      window.clearTimeout(gesture.pressTimer)
    }

    if (gesture.autoScrollFrame !== null) {
      window.cancelAnimationFrame(gesture.autoScrollFrame)
    }

    if (gesture.scrollLocked) {
      window.removeEventListener('touchmove', preventTouchScroll)
      document.documentElement.style.overflow = previousHtmlOverflow
      document.body.style.overflow = previousBodyOverflow
    }

    if (!gesture.painting) {
      setDragGesture(null)

      return
    }

    const top = Math.min(gesture.startRow, gesture.currentRow)
    const bottom = Math.max(gesture.startRow, gesture.currentRow)
    const left = Math.min(gesture.startCol, gesture.currentCol)
    const right = Math.max(gesture.startCol, gesture.currentCol)
    const slotStartUtcIsos: string[] = []

    for (let row = top; row <= bottom; row += 1) {
      for (let col = left; col <= right; col += 1) {
        const day = props.days[col]
        const time = props.times[row]
        const slot = day && time ? props.slotByDayTime[`${day.key}|${time.key}`] : undefined

        if (slot) {
          slotStartUtcIsos.push(slot.startUtcIso)
        }
      }
    }

    setDragGesture(null)

    if (slotStartUtcIsos.length === 0) {
      return
    }

    suppressNextClick = true
    void props.onPaint(slotStartUtcIsos, gesture.targetValue)
  }

  return (
    <div
      ref={(el) => {
        gridRef = el
      }}
      class="availability-grid"
      classList={{
        'availability-grid--dragging': dragGesture()?.painting ?? false,
      }}
      style={{
        '--days': String(Math.max(props.days.length, 1)),
        '--times': String(Math.max(props.times.length, 1)),
        'grid-template-rows': gridTemplateRows(),
      }}
      onPointerMove={(event) => {
        const gesture = dragGesture()

        if (!gesture || gesture.pointerId !== event.pointerId) {
          return
        }

        setDragGesture({
          ...gesture,
          latestClientX: event.clientX,
          latestClientY: event.clientY,
        })

        if (!gesture.painting) {
          if (gesture.pointerType === 'touch') {
            const deltaX = event.clientX - gesture.originX
            const deltaY = event.clientY - gesture.originY

            if (deltaX * deltaX + deltaY * deltaY >= 36) {
              clearDragGesture()
            }

            return
          }

          const deltaX = event.clientX - gesture.originX
          const deltaY = event.clientY - gesture.originY

          if (deltaX * deltaX + deltaY * deltaY < 64) {
            return
          }

          setDragGesture({
            ...gesture,
            painting: true,
            pressTimer: null,
            latestClientX: event.clientX,
            latestClientY: event.clientY,
          })

          gridRef.setPointerCapture(event.pointerId)

          if (navigator.vibrate) {
            navigator.vibrate(10)
          }
        }

        event.preventDefault()
        updateDragTarget(event.clientX, event.clientY)
      }}
      onPointerUp={(event) => {
        const gesture = dragGesture()

        if (!gesture || gesture.pointerId !== event.pointerId) {
          return
        }

        event.preventDefault()
        updateDragTarget(event.clientX, event.clientY)
        finishDragGesture()
      }}
      onPointerCancel={(event) => {
        const gesture = dragGesture()

        if (!gesture || gesture.pointerId !== event.pointerId) {
          return
        }

        clearDragGesture()
      }}
    >
      <div class="availability-grid__corner" />
      <For each={props.days}>
        {(day, dayIndex) => (
          <div class="availability-grid__day" style={{ '--di': String(dayIndex()) }}>
            <span class="availability-grid__day-weekday">{day.weekdayLabel}</span>
            <span class="availability-grid__day-date">
              <Show when={day.showMonthLabel}>
                <span class="availability-grid__day-month">{day.monthLabel}</span>
              </Show>
              <span class="availability-grid__day-number">{day.dayNumberLabel}</span>
            </span>
          </div>
        )}
      </For>
      <For each={props.times}>
        {(time, timeIndex) => (
          <div
            classList={{
              'availability-grid__time': true,
              'availability-grid__time--after-gap': time.gapBefore,
            }}
            style={{ '--ti': String(timeIndex()) }}
          >
            {time.label}
          </div>
        )}
      </For>
      <For each={props.times}>
        {(time, timeIndex) => (
          <Show when={time.gapBefore}>
            <div
              class="availability-grid__gap-time"
              style={{ '--ti': String(timeIndex()) }}
              aria-hidden="true"
            >
              ...
            </div>
          </Show>
        )}
      </For>
      <For each={props.times}>
        {(time, timeIndex) => (
          <For each={props.days}>
            {(day, dayIndex) => {
              const slot = () => props.slotByDayTime[`${day.key}|${time.key}`]
              const slotIndex = () => slot()?.slotIndex
              const slotValue = () => {
                const nextSlot = slot()

                return nextSlot === undefined
                  ? undefined
                  : props.selectedSlots[nextSlot.startUtcIso]
              }
              const displayedValue = () => {
                const bounds = previewBounds()

                if (
                  bounds &&
                  timeIndex() >= bounds.top &&
                  timeIndex() <= bounds.bottom &&
                  dayIndex() >= bounds.left &&
                  dayIndex() <= bounds.right &&
                  slotIndex() !== undefined
                ) {
                  return bounds.targetValue
                }

                return slotValue()
              }
              const hasSlot = () => slotIndex() !== undefined
              const cellLabel = () =>
                hasSlot()
                  ? `${day.label} at ${time.label}. Your availability is ${statusLabel(
                      displayedValue(),
                    )}. Click to mark ${nextStatusLabel(slotValue())}.`
                  : `${day.label} at ${time.label}. No availability slot here.`
              const cellTitle = () =>
                hasSlot()
                  ? `${day.label}, ${time.label}: mark ${nextStatusLabel(slotValue())}`
                  : `${day.label}, ${time.label}: no slot`

              return (
                <button
                  ref={(el) => {
                    cellRefs[timeIndex()] ??= []
                    cellRefs[timeIndex()]![dayIndex()] = el
                  }}
                  type="button"
                  classList={{
                    'availability-grid__cell': true,
                    'availability-grid__cell--yes': displayedValue() === 1,
                    'availability-grid__cell--maybe': displayedValue() === 2,
                    'availability-grid__cell--first-time': timeIndex() === 0,
                    'availability-grid__cell--first-day': dayIndex() === 0,
                    'availability-grid__cell--after-gap': time.gapBefore,
                    'availability-grid__cell--empty': !hasSlot(),
                    'availability-grid__cell--preview': previewContains(timeIndex(), dayIndex()),
                    'availability-grid__cell--preview-top':
                      previewContains(timeIndex(), dayIndex()) &&
                      timeIndex() === previewBounds()?.top,
                    'availability-grid__cell--preview-right':
                      previewContains(timeIndex(), dayIndex()) &&
                      dayIndex() === previewBounds()?.right,
                    'availability-grid__cell--preview-bottom':
                      previewContains(timeIndex(), dayIndex()) &&
                      timeIndex() === previewBounds()?.bottom,
                    'availability-grid__cell--preview-left':
                      previewContains(timeIndex(), dayIndex()) &&
                      dayIndex() === previewBounds()?.left,
                  }}
                  style={{
                    '--ti': String(timeIndex()),
                    '--di': String(dayIndex()),
                  }}
                  aria-label={cellLabel()}
                  title={cellTitle()}
                  disabled={!hasSlot()}
                  onPointerDown={(event) => {
                    const nextSlotIndex = slotIndex()
                    const firstCell = cellRefs[0]?.[0]

                    if (nextSlotIndex === undefined || !firstCell) {
                      return
                    }

                    const rowAnchorCol = dayIndex()
                    const colAnchorRow = timeIndex()
                    const pointerType = event.pointerType
                    const pressTimer =
                      pointerType === 'touch'
                        ? window.setTimeout(() => {
                            activateTouchPainting(event.pointerId)
                          }, 350)
                        : null

                    setDragGesture({
                      pointerId: event.pointerId,
                      pointerType,
                      startRow: timeIndex(),
                      startCol: dayIndex(),
                      currentRow: timeIndex(),
                      currentCol: dayIndex(),
                      originX: event.clientX,
                      originY: event.clientY,
                      targetValue: ((slotValue() ?? 0) + 1) % 3 as SlotValue,
                      painting: false,
                      colLefts: props.days.map(
                        (_, index) =>
                          cellRefs[colAnchorRow]?.[index]?.offsetLeft ?? firstCell.offsetLeft,
                      ),
                      rowTops: props.times.map(
                        (_, index) =>
                          cellRefs[index]?.[rowAnchorCol]?.offsetTop ?? firstCell.offsetTop,
                      ),
                      cellWidth: firstCell.offsetWidth,
                      cellHeight: firstCell.offsetHeight,
                      pressTimer,
                      latestClientX: event.clientX,
                      latestClientY: event.clientY,
                      autoScrollFrame: null,
                      scrollLocked: false,
                    })
                  }}
                  onClick={() => {
                    if (suppressNextClick) {
                      suppressNextClick = false

                      return
                    }

                    const nextSlotIndex = slotIndex()

                    if (nextSlotIndex === undefined) {
                      return
                    }

                    props.onCycle(nextSlotIndex)
                  }}
                >
                  <Show when={displayedValue() === 1}>
                    <span class="availability-grid__icon">✔</span>
                  </Show>
                  <Show when={displayedValue() === 2}>
                    <span class="availability-grid__icon">?</span>
                  </Show>
                </button>
              )
            }}
          </For>
        )}
      </For>
    </div>
  )
}
