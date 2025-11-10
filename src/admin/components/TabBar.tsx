'use client'

import React from 'react'

interface TabBarProps {
  activeTab: 'archive' | 'new' | 'live'
  onChange: (tab: 'archive' | 'new' | 'live') => void
}

export const TabBar: React.FC<TabBarProps> = ({ activeTab, onChange }) => {
  const tabs = [
    { id: 'archive' as const, label: 'ARCHIVE' },
    { id: 'new' as const, label: 'NEW' },
    { id: 'live' as const, label: 'LIVE' },
  ]

  return (
    <div
      style={{
        display: 'flex',
        gap: '4px',
        marginBottom: '12px',
        borderBottom: '1px solid #e9ecef',
        paddingBottom: '8px',
      }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          style={{
            padding: '8px 16px',
            border: 'none',
            background: activeTab === tab.id ? '#f8f9fa' : 'transparent',
            color: activeTab === tab.id ? '#007bff' : '#6c757d',
            fontWeight: activeTab === tab.id ? '600' : '500',
            cursor: 'pointer',
            borderRadius: '4px 4px 0 0',
            transition: 'all 0.15s',
            borderBottom: activeTab === tab.id ? '2px solid #007bff' : '2px solid transparent',
          }}
          onMouseEnter={(e) => {
            if (activeTab !== tab.id) {
              e.currentTarget.style.background = '#f8f9fa'
              e.currentTarget.style.color = '#495057'
            }
          }}
          onMouseLeave={(e) => {
            if (activeTab !== tab.id) {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = '#6c757d'
            }
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
