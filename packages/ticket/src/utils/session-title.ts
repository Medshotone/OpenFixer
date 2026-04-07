const pattern = /^(New session|Child session) - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export function sessionTitle(title?: string) {
  if (!title) return title
  if (title.startsWith("Jira:")) return title.slice(5).trim()
  const match = title.match(pattern)
  return match?.[1] ?? title
}
