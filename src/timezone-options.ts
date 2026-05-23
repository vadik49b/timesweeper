export interface TimezoneOption {
  value: string
  label: string
}

export function getTimezoneOptions(selectedTimezone: string): TimezoneOption[] {
  const supportedValuesOf = Intl.supportedValuesOf as ((key: 'timeZone') => string[]) | undefined
  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const timezones = supportedValuesOf ? supportedValuesOf('timeZone') : [browserTimezone]

  return [...new Set([browserTimezone, selectedTimezone, ...timezones])]
    .map((timezone) => ({
      value: timezone,
      label: formatTimezoneOptionLabel(timezone),
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

function formatTimezoneOptionLabel(timezone: string): string {
  const offset =
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
    })
      .formatToParts(new Date())
      .find((part) => part.type === 'timeZoneName')?.value ?? 'GMT'
  const parts = timezone.split('/')
  const city = parts[parts.length - 1]?.replaceAll('_', ' ') ?? timezone.replaceAll('_', ' ')

  return `${city} — ${offset}`
}
