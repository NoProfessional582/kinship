'use client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Board, ContactSummary, Drafts, ProjectSummary } from '@/lib/api-types'

/** A refusal from the API: its `{ error }` message, and the status it came with. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** The record asked for does not exist: the page says so, rather than erring or retrying. */
export const isNotFound = (err: unknown) => err instanceof ApiError && err.status === 404

/** Worth asking again: a network fault or a server error, never a refusal (400-499). */
export const isRetryable = (err: unknown) =>
  !(err instanceof ApiError && err.status >= 400 && err.status < 500)

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(body.error || `Request failed: ${res.status}`, res.status)
  }
  return res.json()
}

export const api = {
  get: <T>(url: string) => req<T>(url),
  post: <T>(url: string, body: unknown) =>
    req<T>(url, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(url: string, body: unknown) =>
    req<T>(url, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(url: string, body: unknown) =>
    req<T>(url, { method: 'PATCH', body: JSON.stringify(body) }),
  del: <T>(url: string) => req<T>(url, { method: 'DELETE' }),
}

export const keys = {
  board: (projectId: string | null) => ['board', projectId] as const,
  contacts: (q?: string) => ['contacts', q ?? ''] as const,
  projects: () => ['projects'] as const,
  drafts: () => ['drafts'] as const,
}

export function useBoard(projectId: string | null) {
  return useQuery({
    queryKey: keys.board(projectId),
    queryFn: () => api.get<Board>(`/api/tasks${projectId ? `?projectId=${projectId}` : ''}`),
  })
}

export function useContacts(q?: string) {
  return useQuery({
    queryKey: keys.contacts(q),
    queryFn: () =>
      api.get<ContactSummary[]>(`/api/contacts${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  })
}

export function useDrafts() {
  return useQuery({ queryKey: keys.drafts(), queryFn: () => api.get<Drafts>('/api/drafts') })
}

export function useProjects() {
  return useQuery({
    queryKey: keys.projects(),
    queryFn: () => api.get<ProjectSummary[]>('/api/projects'),
  })
}

/**
 * Commits a Kanban drag. The board cache is patched before the request leaves
 * so the card stays where it was dropped, and restored verbatim on failure.
 */
export function useMoveTask(projectId: string | null) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: {
      taskId: string
      columnId: string
      toIndex: number
      projectId?: string | null
      beforeId?: string | null
      afterId?: string | null
    }) =>
      api.patch(`/api/tasks/${vars.taskId}/move`, {
        columnId: vars.columnId,
        toIndex: vars.toIndex,
        projectId: vars.projectId,
        // The visible neighbours of the drop slot. The server orders against
        // these rather than the index, because the index counts only the cards
        // this board was showing — see lib/services/tasks.ts (K05).
        beforeId: vars.beforeId,
        afterId: vars.afterId,
      }),
    onMutate: async (vars) => {
      const key = keys.board(projectId)
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<Board>(key)
      // Only the column and project are patched here. Ordering is deliberately
      // not recomputed: the board holds the dropped order locally until the
      // refetch lands, and duplicating the server's fractional-index maths here
      // was both redundant and wrong under swimlanes, where the visible index is
      // an index within the lane rather than within the whole column.
      qc.setQueryData<Board>(key, (old) => {
        if (!old) return old
        return {
          ...old,
          tasks: old.tasks.map((t) =>
            t.id === vars.taskId
              ? {
                  ...t,
                  columnId: vars.columnId,
                  ...(vars.projectId !== undefined ? { projectId: vars.projectId } : {}),
                }
              : t,
          ),
        }
      })
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(keys.board(projectId), ctx.previous)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.board(projectId) }),
  })
}
