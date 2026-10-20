import { useState } from 'react'

import { adminApi } from '../../api/api'
import type { AdminUser, Role } from '../../api/types'
import { Page } from '../../components/AppShell'
import { Async, Button, Chip, ErrorNote, PageHead, Table, Td } from '../../components/ui'
import { useAsync } from '../../hooks/useAsync'
import { formatDate } from '../../lib/format'

const FILTERS: Array<{ id: Role | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'client', label: 'Clients' },
  { id: 'worker', label: 'Workers' },
  { id: 'admin', label: 'Admins' },
]

// Browse users and suspend or restore them (wireframe 17).
export default function Users() {
  const [role, setRole] = useState<Role | 'all'>('all')
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const state = useAsync(() => adminApi.users(role === 'all' ? undefined : role), [role])

  const toggle = async (user: AdminUser) => {
    const suspending = user.status === 'active'
    const reason = suspending ? window.prompt(`Why are you suspending ${user.name}? (optional)`) : undefined
    if (reason === null) return // cancelled
    setBusyId(user.id)
    setError(null)
    try {
      await adminApi.setUserStatus(user.role, user.id, suspending ? 'suspended' : 'active', reason || undefined)
      state.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update this user')
    } finally {
      setBusyId(null)
    }
  }

  const needle = query.trim().toLowerCase()

  return (
    <Page
      header={
        <PageHead
          title="Users"
          sub={state.data ? `${state.data.filter((u) => u.status === 'active').length} active · ${state.data.filter((u) => u.status === 'suspended').length} suspended` : undefined}
        />
      }
    >
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name, email or phone"
        aria-label="Search users"
        className="h-[46px] w-full rounded-[10px] border-[1.5px] border-[#cfd4db] bg-white px-3.5 text-[15px] placeholder:text-[#9ca3af] focus:border-brand focus:outline-none"
      />
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Chip key={f.id} tone={role === f.id ? 'solid' : 'grey'} onClick={() => setRole(f.id)}>
            {f.label}
          </Chip>
        ))}
      </div>
      {error && <ErrorNote message={error} />}

      <Async state={state}>
        {(users) => {
          const visible = users.filter((u) => !needle || `${u.name} ${u.email} ${u.phone ?? ''}`.toLowerCase().includes(needle))
          return (
            <Table headers={['Name', 'Role', 'Phone', 'Joined', 'Status', '']}>
              {visible.map((u) => (
                <tr key={`${u.role}-${u.id}`}>
                  <Td>
                    <div className="font-bold">{u.name}</div>
                    <div className="text-[13px] text-muted">{u.email}</div>
                  </Td>
                  <Td className="capitalize">{u.role}</Td>
                  <Td>{u.phone ?? '—'}</Td>
                  <Td>{formatDate(u.createdAt)}</Td>
                  <Td>
                    <Chip tone={u.status === 'active' ? 'green' : 'red'}>{u.status === 'active' ? 'Active' : 'Suspended'}</Chip>
                  </Td>
                  <Td>
                    {u.role !== 'admin' && (
                      <Button small tone={u.status === 'active' ? 'danger' : 'outline'} className="h-9 w-[100px]" disabled={busyId === u.id} onClick={() => void toggle(u)}>
                        {u.status === 'active' ? 'Suspend' : 'Restore'}
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )
        }}
      </Async>
    </Page>
  )
}
