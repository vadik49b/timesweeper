import { For, Show } from 'solid-js'

interface Option {
  value: string
  label: string
}

interface BaseProps {
  wrapperClass?: string
  frameClass?: string
  controlClass?: string
}

interface InputProps extends BaseProps {
  kind: 'input'
  type?: 'text' | 'url'
  value: string
  placeholder?: string
  readOnly?: boolean
  autoFocus?: boolean
  onInput?: (value: string) => void
  onClick?: () => void
  inputRef?: (el: HTMLInputElement) => void
}

interface SelectProps extends BaseProps {
  kind: 'select'
  value: string
  options: Option[]
  onChange: (value: string) => void
  selectRef?: (el: HTMLSelectElement) => void
}

type Props = InputProps | SelectProps

export default function Win95Field(props: Props) {
  const wrapperClass = () =>
    ['win95-field', props.wrapperClass].filter(Boolean).join(' ')
  const frameClass = () =>
    [
      'win95-field__frame',
      props.kind === 'select' ? 'win95-field__frame--select' : 'win95-field__frame--input',
      's',
      props.frameClass,
    ]
      .filter(Boolean)
      .join(' ')

  return (
    <div class={wrapperClass()}>
      <div class={frameClass()}>
        <Show when={props.kind === 'input'}>
          <div class="win95-field__input-wrap">
            <input
              ref={(el) => props.kind === 'input' && props.inputRef?.(el)}
              class={['win95-field__control', props.controlClass].filter(Boolean).join(' ')}
              type={props.kind === 'input' ? (props.type ?? 'text') : 'text'}
              value={props.kind === 'input' ? props.value : ''}
              placeholder={props.kind === 'input' ? props.placeholder : ''}
              readOnly={props.kind === 'input' ? props.readOnly : false}
              autofocus={props.kind === 'input' ? props.autoFocus : false}
              onInput={(e) => props.kind === 'input' && props.onInput?.(e.currentTarget.value)}
              onClick={() => props.kind === 'input' && props.onClick?.()}
            />
          </div>
        </Show>
        <Show when={props.kind === 'select'}>
          <div class="win95-field__select-wrap">
            <select
              ref={(el) => props.kind === 'select' && props.selectRef?.(el)}
              class={['win95-field__control', props.controlClass].filter(Boolean).join(' ')}
              value={props.kind === 'select' ? props.value : ''}
              onChange={(e) => props.kind === 'select' && props.onChange(e.currentTarget.value)}
            >
              <For each={props.kind === 'select' ? props.options : []}>
                {(option) => <option value={option.value}>{option.label}</option>}
              </For>
            </select>
            <div class="win95-field__arrow r">▼</div>
          </div>
        </Show>
      </div>
    </div>
  )
}
