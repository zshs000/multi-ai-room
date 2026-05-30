import { ref } from 'vue'

export function useDialog() {
  const dialog = ref(null)

  function openDialog(options) {
    return new Promise((resolve) => {
      dialog.value = { ...options, resolve }
    })
  }

  function confirmDialog(options) {
    return openDialog({ kind: 'confirm', ...options })
  }

  function alertDialog(options) {
    return openDialog({ kind: 'alert', ...options })
  }

  function resolveDialog(value) {
    const current = dialog.value
    dialog.value = null
    current?.resolve(value)
  }

  return { dialog, confirmDialog, alertDialog, resolveDialog }
}
