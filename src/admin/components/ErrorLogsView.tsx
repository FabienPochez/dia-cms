'use client'

import React, { useEffect, useState } from 'react'
import { useAuth } from '@payloadcms/ui'

interface ErrorLog {
  id: string
  userEmail: string
  userRole: string
  collection: string
  operation: string
  errorType: string
  errorCode?: string
  errorMessage: string
  context?: Record<string, unknown>
  httpStatus?: number
  createdAt: string
}

const ErrorLogsView: React.FC = () => {
  const { user } = useAuth()
  const [logs, setLogs] = useState<ErrorLog[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchLogs()
  }, [filter])

  const fetchLogs = async () => {
    try {
      setLoading(true)
      let url = '/api/upload-error-logs?limit=50&sort=-createdAt'
      
      if (filter !== 'all') {
        url += `&where[errorType][equals]=${filter}`
      }

      const response = await fetch(url, {
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error('Failed to fetch error logs')
      }

      const data = await response.json()
      setLogs(data.docs || [])
    } catch (err) {
      console.error('[ERROR_LOGS] Failed to fetch:', err)
      setError('Failed to load error logs')
    } finally {
      setLoading(false)
    }
  }

  const getErrorTypeColor = (errorType: string): string => {
    const colors: Record<string, string> = {
      audio_quality: '#ef4444',
      validation: '#f59e0b',
      file_upload: '#8b5cf6',
      permission: '#ec4899',
      server: '#dc2626',
      other: '#6b7280',
    }
    return colors[errorType] || '#6b7280'
  }

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString)
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  if (!user || (user.role !== 'admin' && user.role !== 'staff')) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <h2>Access Denied</h2>
        <p>You don't have permission to view error logs.</p>
      </div>
    )
  }

  return (
    <div style={{ padding: '20px', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ marginBottom: '30px' }}>
        <h1 style={{ fontSize: '32px', fontWeight: 'bold', marginBottom: '8px' }}>
          📋 Upload Error Logs
        </h1>
        <p style={{ fontSize: '14px', color: '#666' }}>
          Monitor and track all upload-related errors with user information
        </p>
      </div>

      {/* Filters */}
      <div style={{ marginBottom: '20px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {['all', 'audio_quality', 'validation', 'file_upload', 'permission', 'server'].map(
          (filterType) => (
            <button
              key={filterType}
              onClick={() => setFilter(filterType)}
              style={{
                padding: '8px 16px',
                fontSize: '14px',
                border: '1px solid #d1d5db',
                borderRadius: '6px',
                cursor: 'pointer',
                backgroundColor: filter === filterType ? '#3b82f6' : '#fff',
                color: filter === filterType ? '#fff' : '#374151',
                fontWeight: filter === filterType ? 'bold' : 'normal',
              }}
            >
              {filterType === 'all' ? 'All' : filterType.replace('_', ' ')}
            </button>
          ),
        )}
        <button
          onClick={fetchLogs}
          style={{
            padding: '8px 16px',
            fontSize: '14px',
            border: '1px solid #d1d5db',
            borderRadius: '6px',
            cursor: 'pointer',
            backgroundColor: '#10b981',
            color: '#fff',
            marginLeft: 'auto',
          }}
        >
          🔄 Refresh
        </button>
      </div>

      {/* Error message */}
      {error && (
        <div
          style={{
            padding: '16px',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: '6px',
            marginBottom: '20px',
          }}
        >
          <p style={{ color: '#dc2626', fontWeight: 'bold' }}>{error}</p>
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <p>Loading error logs...</p>
        </div>
      ) : logs.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '40px',
            backgroundColor: '#f9fafb',
            borderRadius: '8px',
          }}
        >
          <p style={{ fontSize: '18px', color: '#6b7280' }}>
            ✅ No errors found! Everything is working smoothly.
          </p>
        </div>
      ) : (
        /* Error logs table */
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              backgroundColor: '#fff',
              borderRadius: '8px',
              overflow: 'hidden',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            }}
          >
            <thead>
              <tr style={{ backgroundColor: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                <th style={headerStyle}>Time</th>
                <th style={headerStyle}>User</th>
                <th style={headerStyle}>Type</th>
                <th style={headerStyle}>Code</th>
                <th style={headerStyle}>Collection</th>
                <th style={headerStyle}>Error Message</th>
                <th style={headerStyle}>Status</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr
                  key={log.id}
                  style={{ borderBottom: '1px solid #e5e7eb' }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f9fafb')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#fff')}
                >
                  <td style={cellStyle}>
                    <span style={{ fontSize: '12px', color: '#6b7280' }}>
                      {formatDate(log.createdAt)}
                    </span>
                  </td>
                  <td style={cellStyle}>
                    <div>
                      <div style={{ fontWeight: 'bold', fontSize: '14px' }}>{log.userEmail}</div>
                      <div style={{ fontSize: '12px', color: '#6b7280' }}>{log.userRole}</div>
                    </div>
                  </td>
                  <td style={cellStyle}>
                    <span
                      style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        backgroundColor: getErrorTypeColor(log.errorType) + '20',
                        color: getErrorTypeColor(log.errorType),
                        fontSize: '12px',
                        fontWeight: 'bold',
                        display: 'inline-block',
                      }}
                    >
                      {log.errorType}
                    </span>
                  </td>
                  <td style={cellStyle}>
                    <code
                      style={{
                        fontSize: '12px',
                        padding: '2px 6px',
                        backgroundColor: '#f3f4f6',
                        borderRadius: '3px',
                      }}
                    >
                      {log.errorCode || 'N/A'}
                    </code>
                  </td>
                  <td style={cellStyle}>
                    <span style={{ fontSize: '13px' }}>{log.collection}</span>
                  </td>
                  <td style={{ ...cellStyle, maxWidth: '300px' }}>
                    <details>
                      <summary
                        style={{
                          cursor: 'pointer',
                          fontSize: '13px',
                          color: '#374151',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {log.errorMessage.substring(0, 60)}
                        {log.errorMessage.length > 60 ? '...' : ''}
                      </summary>
                      <div
                        style={{
                          marginTop: '8px',
                          padding: '8px',
                          backgroundColor: '#fef2f2',
                          borderRadius: '4px',
                          fontSize: '12px',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {log.errorMessage}
                        {log.context && (
                          <details style={{ marginTop: '8px' }}>
                            <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>
                              Context
                            </summary>
                            <pre
                              style={{
                                marginTop: '4px',
                                fontSize: '11px',
                                overflow: 'auto',
                              }}
                            >
                              {JSON.stringify(log.context, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    </details>
                  </td>
                  <td style={cellStyle}>
                    <span
                      style={{
                        fontSize: '12px',
                        fontWeight: 'bold',
                        color: (log.httpStatus || 500) >= 500 ? '#dc2626' : '#f59e0b',
                      }}
                    >
                      {log.httpStatus || 'N/A'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: '20px', fontSize: '14px', color: '#6b7280', textAlign: 'center' }}>
        Showing {logs.length} error log{logs.length !== 1 ? 's' : ''}
      </div>
    </div>
  )
}

const headerStyle: React.CSSProperties = {
  padding: '12px',
  textAlign: 'left',
  fontSize: '12px',
  fontWeight: 'bold',
  color: '#374151',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
}

const cellStyle: React.CSSProperties = {
  padding: '12px',
  fontSize: '14px',
  color: '#374151',
}

export default ErrorLogsView








