import Win95Button from './Win95Button'
import Win95Dialog from './Win95Dialog'

interface Props {
  message: string
  onClose: () => void
  title?: string
}

export default function ErrorDialog(props: Props) {
  return (
    <Win95Dialog
      title={props.title ?? 'Validation Error'}
      class="dialog--error"
      bodyClass="dialog-body--error"
      onClose={props.onClose}
    >
      <div class="error-dialog__row">
        <span class="error-dialog__icon" aria-hidden="true">
          ✖
        </span>
        <p class="error-dialog__text">{props.message}</p>
      </div>
      <div class="dialog-buttons error-dialog__actions">
        <Win95Button class="dialog-btn" onClick={props.onClose}>
          OK
        </Win95Button>
      </div>
    </Win95Dialog>
  )
}
