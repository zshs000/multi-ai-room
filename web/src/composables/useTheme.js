import { ref } from 'vue'

export function useTheme() {
  const theme = ref(localStorage.getItem('theme') || 'light')

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', theme.value)
  }

  function toggleTheme() {
    theme.value = theme.value === 'light' ? 'dark' : 'light'
    localStorage.setItem('theme', theme.value)
    applyTheme()
  }

  return { theme, applyTheme, toggleTheme }
}
