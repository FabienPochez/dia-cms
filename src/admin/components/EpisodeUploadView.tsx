'use client'

import React, { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import NewEpisodeLauncher from './NewEpisodeLauncher'

interface UserData {
  id: string
  email: string
  role: string
}

interface HostData {
  id: string
  name: string
  show: string[] // Array of show IDs
}

interface ShowData {
  id: string
  title: string
  hosts?: Array<{ id: string; name: string }>
}

interface GenreData {
  id: string
  name: string
}

const EpisodeUploadView: React.FC = () => {
  const router = useRouter()
  const searchParams = useSearchParams()
  const episodeId = searchParams.get('episodeId')

  // Auth & user state
  const [isLoading, setIsLoading] = useState(true)
  const [user, setUser] = useState<UserData | null>(null)
  const [host, setHost] = useState<HostData | null>(null)
  const [shows, setShows] = useState<ShowData[]>([])
  const [genres, setGenres] = useState<GenreData[]>([])
  const [hostsLookup, setHostsLookup] = useState<Map<string, { id: string; name: string }>>(
    new Map(),
  )

  // Form state
  const [selectedShowId, setSelectedShowId] = useState<string>('')
  const [selectedHostIds, setSelectedHostIds] = useState<string[]>([])
  const [title, setTitle] = useState<string>('')
  const [description, setDescription] = useState<string>('')
  const [tracklistRaw, setTracklistRaw] = useState<string>('')
  const [publishedAt, setPublishedAt] = useState<string>(new Date().toISOString().split('T')[0])
  const [selectedDuration, setSelectedDuration] = useState<number>(60)
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [coverImage, setCoverImage] = useState<File | null>(null)

  // Metadata fields
  const [energy, setEnergy] = useState<string>('')
  const [mood, setMood] = useState<string>('')
  const [tone, setTone] = useState<string>('')
  const [selectedGenres, setSelectedGenres] = useState<string[]>([])

  // UI state
  const [showClassificationModal, setShowClassificationModal] = useState(false)

  // Upload state
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<string>('')
  const [uploadPercent, setUploadPercent] = useState<number>(0)
  const [error, setError] = useState<string>('')

  useEffect(() => {
    checkAuthAndLoadData()
  }, [])

  // Auto-select logged-in host when show is selected
  useEffect(() => {
    if (!selectedShowId || !host) return

    const selectedShow = shows.find((s) => s.id === selectedShowId)
    if (!selectedShow?.hosts) return

    // Check if logged-in host is in the show (handle both objects and string IDs)
    const isInShow = selectedShow.hosts.some((h: any) => {
      if (typeof h === 'string') return h === host.id
      return h && h.id === host.id
    })
    
    setSelectedHostIds(isInShow ? [host.id] : [])
  }, [selectedShowId, host, shows])

  const checkAuthAndLoadData = async () => {
    try {
      setIsLoading(true)

      // Get current user
      const userResponse = await fetch('/api/users/me', {
        credentials: 'include',
      })

      if (!userResponse.ok) {
        // Redirect to login with return URL so user comes back here after login
        const returnUrl = encodeURIComponent('/admin/upload-episode')
        router.push(`/admin/login?redirect=${returnUrl}`)
        return
      }

      const userData = await userResponse.json()

      // Check if user is authenticated
      if (!userData?.user) {
        const returnUrl = encodeURIComponent('/admin/upload-episode')
        router.push(`/admin/login?redirect=${returnUrl}`)
        return
      }

      // Check role - must be host, staff, or admin
      if (!['host', 'staff', 'admin'].includes(userData.user.role)) {
        setError('Access denied. Only hosts and staff can upload episodes.')
        setIsLoading(false)
        return
      }

      setUser(userData.user)

      // Get host from user's linked host field
      if (!userData.user.host) {
        setError('No host profile linked to your account. Please contact an administrator.')
        setIsLoading(false)
        return
      }

      // Fetch full host data
      const hostId =
        typeof userData.user.host === 'string' ? userData.user.host : userData.user.host.id
      const hostResponse = await fetch(`/api/hosts/${hostId}?depth=1`, {
        credentials: 'include',
      })

      if (!hostResponse.ok) {
        throw new Error('Failed to fetch host data')
      }

      const hostData = await hostResponse.json()
      setHost(hostData)

      // Load shows associated with this host (from join field)
      if (hostData.shows && hostData.shows.docs && hostData.shows.docs.length > 0) {
        // Fetch each show with depth to populate host data
        const showPromises = hostData.shows.docs.map(async (show: any) => {
          try {
            const res = await fetch(`/api/shows/${show.id}?depth=2`, { credentials: 'include' })
            if (res.ok) {
              return await res.json()
            }
          } catch (err) {
            console.error('Failed to fetch show:', show.id, err)
          }
          return show // fallback to original
        })
        
        const fullyLoadedShows = await Promise.all(showPromises)
        setShows(fullyLoadedShows)
        
        // Build a lookup map of all hosts from the fully loaded shows
        const hostsMap = new Map<string, { id: string; name: string }>()
        fullyLoadedShows.forEach((show: any) => {
          console.log(`Show "${show.title}" hosts:`, show.hosts)
          if (show.hosts && Array.isArray(show.hosts)) {
            show.hosts.forEach((h: any) => {
              if (typeof h === 'string') {
                console.log('  - String ID (no name):', h)
              } else if (h && h.id && h.name) {
                console.log('  - Object with name:', h.name)
                hostsMap.set(h.id, { id: h.id, name: h.name })
              }
            })
          }
        })
        setHostsLookup(hostsMap)
        console.log('Final hosts lookup:', Array.from(hostsMap.values()))
      }

      // Load all genres and sort alphabetically
      const genresResponse = await fetch('/api/genres?limit=100', {
        credentials: 'include',
      })
      if (genresResponse.ok) {
        const genresData = await genresResponse.json()
        const sortedGenres = (genresData.docs || []).sort((a: GenreData, b: GenreData) =>
          a.name.localeCompare(b.name),
        )
        setGenres(sortedGenres)
      }

      setIsLoading(false)
    } catch (err) {
      console.error('[UPLOAD] Auth check failed:', err)
      setError(err instanceof Error ? err.message : 'Failed to load data')
      setIsLoading(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]

      // Validate file type
      if (!file.type.includes('audio')) {
        setError('Please select a valid audio file')
        return
      }

      setAudioFile(file)
      setError('')
    }
  }

  const handleCoverChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]

      // Validate file type
      if (!file.type.includes('image')) {
        setError('Please select a valid image file')
        return
      }

      setCoverImage(file)
      setError('')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!selectedShowId) {
      setError('Please select a show')
      return
    }

    // Validate hosts for multi-host shows
    const selectedShow = shows.find((s) => s.id === selectedShowId)
    if (selectedShow?.hosts && selectedShow.hosts.length > 1 && selectedHostIds.length === 0) {
      setError('Please select at least one host for this episode')
      return
    }

    if (!audioFile) {
      setError('Please select an audio file')
      return
    }

    setIsUploading(true)
    setError('')
    setUploadProgress('Uploading audio file...')
    setUploadPercent(0)

    try {
      // Step 1: Upload audio file to media-tracks with progress tracking
      const formData = new FormData()
      formData.append('file', audioFile)
      
      // Append episodeId to FormData (for server-side filename generation)
      if (episodeId) {
        formData.append('episodeId', episodeId)
      }

      // Use uploads subdomain (DNS-only, bypasses Cloudflare 100MB limit)
      const uploadsHost =
        process.env.NEXT_PUBLIC_UPLOADS_HOST || 'https://upload.content.diaradio.live'
      
      // Also append episodeId as query parameter (redundancy)
      const uploadUrl = episodeId 
        ? `${uploadsHost}/api/media-tracks?episodeId=${encodeURIComponent(episodeId)}`
        : `${uploadsHost}/api/media-tracks`

      // Use XMLHttpRequest for progress tracking
      const uploadPromise = new Promise<any>((resolve, reject) => {
        const xhr = new XMLHttpRequest()

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percentComplete = Math.round((e.loaded / e.total) * 100)
            setUploadPercent(percentComplete)
            setUploadProgress(`Uploading audio file... ${percentComplete}%`)
          }
        })

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const response = JSON.parse(xhr.responseText)
              resolve(response)
            } catch (err) {
              reject(new Error('Failed to parse upload response'))
            }
          } else {
            try {
              const errorData = JSON.parse(xhr.responseText)
              reject(new Error(errorData.errors?.[0]?.message || 'Failed to upload audio file'))
            } catch {
              reject(new Error(`Upload failed with status ${xhr.status}`))
            }
          }
        })

        xhr.addEventListener('error', () => {
          reject(new Error('Network error during upload'))
        })

        xhr.open('POST', uploadUrl)
        xhr.withCredentials = true
        xhr.send(formData)
      })

      const uploadData = await uploadPromise
      const mediaTrackId = uploadData.doc.id

      setUploadPercent(100)
      setUploadProgress('Audio upload complete!')

      // Step 1.5: Upload cover image if provided (optional)
      let coverImageId: string | undefined
      if (coverImage) {
        setUploadProgress('Uploading cover image...')
        
        const coverFormData = new FormData()
        coverFormData.append('file', coverImage)
        
        // Append episodeId (for server-side compression and filename generation)
        if (episodeId) {
          coverFormData.append('episodeId', episodeId)
        }
        
        const coverUploadUrl = episodeId 
          ? `${uploadsHost}/api/media-images?episodeId=${encodeURIComponent(episodeId)}`
          : `${uploadsHost}/api/media-images`
        
        const coverResponse = await fetch(coverUploadUrl, {
          method: 'POST',
          credentials: 'include',
          body: coverFormData,
        })
        
        if (!coverResponse.ok) {
          const errorData = await coverResponse.json()
          throw new Error(errorData.errors?.[0]?.message || 'Failed to upload cover image')
        }
        
        const coverData = await coverResponse.json()
        coverImageId = coverData.doc.id
        
        setUploadProgress('Cover image uploaded!')
      }

      setUploadProgress('Creating episode...')

      // Step 2: Create or update episode
      const episodeData = {
        show: selectedShowId,
        hosts: selectedHostIds.length > 0 ? selectedHostIds : [host?.id],
        title: title || undefined, // Let it auto-fill from show if empty
        description: description || undefined,
        tracklistRaw: tracklistRaw || undefined,
        publishedAt: new Date(publishedAt).toISOString(),
        publishedStatus: 'submitted',
        airStatus: 'draft',
        pendingReview: true,
        media: mediaTrackId,
        cover: coverImageId || undefined, // Optional cover image
        duration: selectedDuration * 60, // Convert minutes to seconds
        roundedDuration: selectedDuration,
        energy: energy || undefined,
        mood: mood || undefined,
        tone: tone || undefined,
        genres: selectedGenres.length > 0 ? selectedGenres : undefined,
      }

      // Use PATCH if episodeId exists (pre-assigned), otherwise POST
      const episodeUrl = episodeId ? `/api/episodes/${episodeId}` : '/api/episodes'
      const episodeMethod = episodeId ? 'PATCH' : 'POST'

      const episodeResponse = await fetch(episodeUrl, {
        method: episodeMethod,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(episodeData),
      })

      if (!episodeResponse.ok) {
        const errorData = await episodeResponse.json()
        throw new Error(errorData.errors?.[0]?.message || `Failed to ${episodeId ? 'update' : 'create'} episode`)
      }

      const episodeResult = await episodeResponse.json()

      setUploadProgress('Episode uploaded successfully!')

      // Redirect to success page after a short delay
      setTimeout(() => {
        const episodeTitle = title || episodeResult.doc.title || 'Your episode'
        router.push(`/admin/upload-success?title=${encodeURIComponent(episodeTitle)}`)
      }, 2000)
    } catch (err) {
      console.error('[UPLOAD] Upload failed:', err)
      setError(err instanceof Error ? err.message : 'Upload failed')
      setIsUploading(false)
      setUploadProgress('')
      setUploadPercent(0)
    }
  }

  if (isLoading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <h1>Loading...</h1>
      </div>
    )
  }

  if (error && !user) {
    return (
      <div style={{ padding: '40px' }}>
        <h1>Episode Upload</h1>
        <div
          style={{
            color: '#F44336',
            marginTop: '20px',
            padding: '15px',
            backgroundColor: '#FFEBEE',
            borderRadius: '4px',
          }}
        >
          {error}
        </div>
      </div>
    )
  }

  // Show launcher if no episodeId in URL
  if (!episodeId) {
    return <NewEpisodeLauncher />
  }

  return (
    <div style={{ padding: '40px', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '10px' }}>Upload New Episode</h1>

      {user && (
        <p style={{ color: '#666', marginBottom: '30px' }}>
          Logged in as <strong>{user.email}</strong> ({user.role})
          {host && (
            <>
              {' '}
              • Host: <strong>{host.name}</strong>
            </>
          )}
        </p>
      )}

      {error && (
        <div
          style={{
            color: '#F44336',
            marginBottom: '20px',
            padding: '15px',
            backgroundColor: '#FFEBEE',
            borderRadius: '4px',
            border: '1px solid #FFCDD2',
          }}
        >
          {error}
        </div>
      )}

      {uploadProgress && (
        <div
          style={{
            marginBottom: '20px',
            padding: '15px',
            backgroundColor: '#E8F5E9',
            borderRadius: '4px',
            border: '1px solid #C8E6C9',
          }}
        >
          <div style={{ color: '#4CAF50', marginBottom: '10px', fontWeight: 'bold' }}>
            {uploadProgress}
          </div>
          {isUploading && uploadPercent < 100 && (
            <div
              style={{
                width: '100%',
                backgroundColor: '#C8E6C9',
                borderRadius: '4px',
                height: '8px',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${uploadPercent}%`,
                  backgroundColor: '#4CAF50',
                  height: '100%',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Show Selection */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
            Show <span style={{ color: '#F44336' }}>*</span>
          </label>
          <select
            value={selectedShowId}
            onChange={(e) => setSelectedShowId(e.target.value)}
            required
            disabled={isUploading}
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: '4px',
              border: '1px solid #ddd',
              fontSize: '14px',
            }}
          >
            <option value="">Select a show...</option>
            {shows.map((show) => (
              <option key={show.id} value={show.id}>
                {show.title}
              </option>
            ))}
          </select>
          {shows.length === 0 && (
            <p style={{ color: '#666', fontSize: '12px', marginTop: '5px' }}>
              No shows found. Please contact staff to create a show.
            </p>
          )}
        </div>

        {/* Episode Hosts (conditional - only for multi-host shows) */}
        {(() => {
          const selectedShow = shows.find((s) => s.id === selectedShowId)
          if (!selectedShow?.hosts || !Array.isArray(selectedShow.hosts)) return null

          // Get host details from lookup, handling both objects and string IDs
          const showHostsData = selectedShow.hosts
            .map((h: any) => {
              // If it's already an object with name, use it
              if (h && typeof h === 'object' && h.id && h.name) {
                return { id: h.id, name: h.name }
              }
              // If it's a string ID, look it up
              if (typeof h === 'string') {
                const hostFromLookup = hostsLookup.get(h)
                if (hostFromLookup) return hostFromLookup
              }
              return null
            })
            .filter(Boolean) as Array<{ id: string; name: string }>

          // Only show if 2+ hosts with complete data
          if (showHostsData.length < 2) return null

          return (
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
                Episode Hosts <span style={{ color: '#F44336' }}>*</span>
              </label>
              {showHostsData.map((h) => (
                <div key={h.id} style={{ marginBottom: '8px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={selectedHostIds.includes(h.id)}
                      onChange={() => {
                        setSelectedHostIds((prev) =>
                          prev.includes(h.id)
                            ? prev.filter((id) => id !== h.id)
                            : [...prev, h.id],
                        )
                      }}
                      disabled={isUploading}
                      style={{ marginRight: '8px', cursor: 'pointer' }}
                    />
                    <span>{h.name}</span>
                  </label>
                </div>
              ))}
              <p style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
                Select the hosts who participated in this episode.
              </p>
            </div>
          )
        })()}

        {/* Title */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
            Title{' '}
            <span style={{ fontSize: '12px', fontWeight: 'normal', color: '#666' }}>
              (optional, inherits from show)
            </span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={isUploading}
            placeholder="Episode title..."
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: '4px',
              border: '1px solid #ddd',
              fontSize: '14px',
            }}
          />
        </div>

        {/* Description */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
            Description{' '}
            <span style={{ fontSize: '12px', fontWeight: 'normal', color: '#666' }}>
              (optional, inherits from show)
            </span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={isUploading}
            placeholder="Episode description..."
            rows={4}
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: '4px',
              border: '1px solid #ddd',
              fontSize: '14px',
              fontFamily: 'inherit',
            }}
          />
        </div>

        {/* Cover Image */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
            Cover Image{' '}
            <span style={{ fontSize: '12px', fontWeight: 'normal', color: '#666' }}>
              (optional, inherits from show)
            </span>
          </label>
          <input
            type="file"
            accept="image/*"
            onChange={handleCoverChange}
            disabled={isUploading}
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: '4px',
              border: '2px dashed #ddd',
              fontSize: '14px',
            }}
          />
          {coverImage && (
            <p style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
              Selected: {coverImage.name} ({(coverImage.size / 1024 / 1024).toFixed(2)} MB)
            </p>
          )}
          <p style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
            Images will be automatically optimized (max 1500px, JPG format, 70% quality)
          </p>
        </div>

        {/* Tracklist */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
            Show tracklist : <span style={{ color: '#F44336' }}>*</span>
          </label>
          <textarea
            value={tracklistRaw}
            onChange={(e) => setTracklistRaw(e.target.value)}
            disabled={isUploading}
            required
            placeholder={
              'VIA MARIS - Lapse\nNYOP & ZORA JONES - Descent\nFARSIGHT - Cadena\nBADSISTA - Sheela\nZALIVA-D – Whisper\nSCRATCHA DVA - Allayallrecords (Lokane Remix)'
            }
            rows={8}
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: '4px',
              border: '1px solid #ddd',
              fontSize: '14px',
              fontFamily: 'monospace',
            }}
          />
          <p style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
            Please use this nomenclature: <strong>"ARTIST - Title"</strong>, one track per line.{' '}
            <a
              href="https://regex101.com/r/Mubpob/1"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#0066cc' }}
            >
              You can use this script to automatise it
            </a>
            .
          </p>
        </div>

        {/* Energy */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
            Energy
            <button
              type="button"
              onClick={() => setShowClassificationModal(true)}
              style={{
                marginLeft: '10px',
                padding: '2px 8px',
                backgroundColor: '#28a745',
                color: '#fff',
                border: 'none',
                borderRadius: '50%',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 'bold',
              }}
              title="Classification guide"
            >
              ?
            </button>
          </label>
          <select
            value={energy}
            onChange={(e) => setEnergy(e.target.value)}
            disabled={isUploading}
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: '4px',
              border: '1px solid #ddd',
              fontSize: '14px',
            }}
          >
            <option value="">-- Select Energy --</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>

        {/* Mood */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
            Mood
            <button
              type="button"
              onClick={() => setShowClassificationModal(true)}
              style={{
                marginLeft: '10px',
                padding: '2px 8px',
                backgroundColor: '#28a745',
                color: '#fff',
                border: 'none',
                borderRadius: '50%',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 'bold',
              }}
              title="Classification guide"
            >
              ?
            </button>
          </label>
          <select
            value={mood}
            onChange={(e) => setMood(e.target.value)}
            disabled={isUploading}
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: '4px',
              border: '1px solid #ddd',
              fontSize: '14px',
            }}
          >
            <option value="">-- Select Mood --</option>
            <option value="sedative">Sedative</option>
            <option value="cozy">Cozy</option>
            <option value="groovy">Groovy</option>
            <option value="club">Club</option>
            <option value="adrenaline">Adrenaline</option>
            <option value="hard">Hard</option>
            <option value="psychedelic">Psychedelic</option>
            <option value="leftfield">Leftfield</option>
            <option value="research">Research</option>
          </select>
        </div>

        {/* Tone */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
            Tone
            <button
              type="button"
              onClick={() => setShowClassificationModal(true)}
              style={{
                marginLeft: '10px',
                padding: '2px 8px',
                backgroundColor: '#28a745',
                color: '#fff',
                border: 'none',
                borderRadius: '50%',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 'bold',
              }}
              title="Classification guide"
            >
              ?
            </button>
          </label>
          <select
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            disabled={isUploading}
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: '4px',
              border: '1px solid #ddd',
              fontSize: '14px',
            }}
          >
            <option value="">-- Select Tone --</option>
            <option value="dark">Dark</option>
            <option value="bright">Bright</option>
            <option value="melancholic">Melancholic</option>
            <option value="dreamy">Dreamy</option>
            <option value="nostalgic">Nostalgic</option>
            <option value="neutral">Neutral</option>
          </select>
        </div>

        {/* Genres */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
            Genres{' '}
            <span style={{ fontSize: '12px', fontWeight: 'normal', color: '#666' }}>
              (hold Ctrl/Cmd to select multiple)
            </span>
            <button
              type="button"
              onClick={() => setShowClassificationModal(true)}
              style={{
                marginLeft: '10px',
                padding: '2px 8px',
                backgroundColor: '#28a745',
                color: '#fff',
                border: 'none',
                borderRadius: '50%',
                cursor: 'pointer',
                fontSize: '12px',
                fontWeight: 'bold',
              }}
              title="Classification guide"
            >
              ?
            </button>
          </label>
          <select
            multiple
            value={selectedGenres}
            onChange={(e) => {
              const selected = Array.from(e.target.selectedOptions, (option) => option.value)
              setSelectedGenres(selected)
            }}
            disabled={isUploading}
            size={8}
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: '4px',
              border: '1px solid #ddd',
              fontSize: '14px',
            }}
          >
            {genres.map((genre) => (
              <option key={genre.id} value={genre.id}>
                {genre.name}
              </option>
            ))}
          </select>
          <p style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
            {selectedGenres.length > 0 && `${selectedGenres.length} genre(s) selected`}
          </p>
        </div>

        {/* Classification Rules Reminder */}
        <div
          style={{
            marginBottom: '20px',
            padding: '15px',
            backgroundColor: '#FFF3E0',
            border: '1px solid #FFE0B2',
            borderRadius: '4px',
          }}
        >
          <p style={{ fontSize: '13px', margin: 0, color: '#E65100', fontWeight: 'bold' }}>
            📋 Classification Requirements:
          </p>
          <ul style={{ fontSize: '12px', margin: '8px 0 0 0', paddingLeft: '20px', color: '#666' }}>
            <li>
              Pick <strong>1 Energy</strong> (required)
            </li>
            <li>
              Pick <strong>at least 1</strong> between Mood or Tone (required)
            </li>
            <li>
              Select <strong>at least 2 Genres</strong> (required)
            </li>
            <li style={{ marginTop: '5px', color: '#999' }}>
              💡 Tip: Click green "?" buttons for detailed definitions
            </li>
          </ul>
        </div>

        {/* Published Date - Auto-set, non-editable */}
        <div style={{ marginBottom: '20px' }}>
          <label
            style={{
              display: 'block',
              marginBottom: '8px',
              fontWeight: 'normal',
              fontSize: '12px',
              color: '#999',
            }}
          >
            Published Date (auto-set to today)
          </label>
          <input
            type="date"
            value={publishedAt}
            disabled
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: '4px',
              border: '1px solid #e0e0e0',
              fontSize: '14px',
              backgroundColor: '#f5f5f5',
              color: '#999',
              cursor: 'not-allowed',
            }}
          />
        </div>

        {/* Duration Selection */}
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
            Duration <span style={{ color: '#F44336' }}>*</span>
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            {[60, 120, 180, 240, 300, 360].map((duration) => (
              <label
                key={duration}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '10px 15px',
                  borderRadius: '4px',
                  border: '2px solid',
                  borderColor: selectedDuration === duration ? '#007bff' : '#ddd',
                  backgroundColor: selectedDuration === duration ? '#E3F2FD' : '#fff',
                  cursor: isUploading ? 'not-allowed' : 'pointer',
                  opacity: isUploading ? 0.5 : 1,
                }}
              >
                <input
                  type="radio"
                  name="duration"
                  value={duration}
                  checked={selectedDuration === duration}
                  onChange={(e) => setSelectedDuration(parseInt(e.target.value))}
                  disabled={isUploading}
                  style={{ marginRight: '8px' }}
                />
                {duration} minutes
              </label>
            ))}
          </div>
        </div>

        {/* Audio File Upload */}
        <div style={{ marginBottom: '30px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
            Audio File <span style={{ color: '#F44336' }}>*</span>
          </label>
          <input
            type="file"
            accept="audio/*"
            onChange={handleFileChange}
            disabled={isUploading}
            required
            style={{
              width: '100%',
              padding: '10px',
              borderRadius: '4px',
              border: '2px dashed #ddd',
              fontSize: '14px',
            }}
          />
          {audioFile && (
            <p style={{ fontSize: '12px', color: '#666', marginTop: '5px' }}>
              Selected: {audioFile.name} ({(audioFile.size / 1024 / 1024).toFixed(2)} MB)
            </p>
          )}
          <div style={{ fontSize: '12px', color: '#666', marginTop: '10px' }}>
            <strong>Required:</strong>
            <ul style={{ margin: '5px 0', paddingLeft: '20px', lineHeight: '1.6' }}>
              <li>
                <strong>File format:</strong> MP3
              </li>
              <li>
                <strong>Bitrate:</strong> 320 kbps (exactly)
              </li>
              <li>
                <strong>Sample rate:</strong> 44.1 kHz (exactly)
              </li>
              <li>
                <strong>Duration:</strong> Minimum {selectedDuration - 1} minutes for{' '}
                {selectedDuration}-minute slot
              </li>
              <li style={{ color: '#555' }}>No maximum duration - longer tracks are accepted</li>
            </ul>
          </div>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isUploading || shows.length === 0}
          style={{
            padding: '12px 24px',
            backgroundColor: isUploading || shows.length === 0 ? '#ccc' : '#007bff',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            fontSize: '16px',
            fontWeight: 'bold',
            cursor: isUploading || shows.length === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          {isUploading ? 'Uploading...' : 'Upload Episode'}
        </button>
      </form>

      {/* Classification Guide Modal */}
      {showClassificationModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
          onClick={() => setShowClassificationModal(false)}
        >
          <div
            style={{
              backgroundColor: '#fff',
              padding: '30px',
              borderRadius: '8px',
              maxWidth: '700px',
              maxHeight: '85vh',
              overflowY: 'auto',
              position: 'relative',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowClassificationModal(false)}
              style={{
                position: 'absolute',
                top: '10px',
                right: '10px',
                background: 'none',
                border: 'none',
                fontSize: '24px',
                cursor: 'pointer',
                color: '#666',
              }}
            >
              ×
            </button>

            <h2 style={{ marginTop: 0 }}>Mood Classification System</h2>

            <div style={{ lineHeight: '1.6' }}>
              <h3>1. Mood (functional – pick 1, mandatory)</h3>
              <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
                <li style={{ marginBottom: '8px' }}>
                  <strong>Sedative</strong> → calm, soothing, low-energy
                </li>
                <li style={{ marginBottom: '8px' }}>
                  <strong>Cozy</strong> → warm, accessible, background-friendly
                </li>
                <li style={{ marginBottom: '8px' }}>
                  <strong>Groovy</strong> → rhythmic, steady, body-moving
                </li>
                <li style={{ marginBottom: '8px' }}>
                  <strong>Club</strong> → dancefloor, euphoric, medium-high drive
                </li>
                <li style={{ marginBottom: '8px' }}>
                  <strong>Adrenaline</strong> → workout, peak intensity, high drive
                </li>
                <li style={{ marginBottom: '8px' }}>
                  <strong>Hard</strong> → abrasive, extreme, noisy
                </li>
                <li style={{ marginBottom: '8px' }}>
                  <strong>Psychedelic</strong> → trippy, hypnotic, altered states
                </li>
                <li style={{ marginBottom: '8px' }}>
                  <strong>Leftfield</strong> → oddball, disruptive, genre-bending
                </li>
                <li style={{ marginBottom: '8px' }}>
                  <strong>Research</strong> → conceptual, process-oriented, experimental
                </li>
              </ul>

              <hr style={{ margin: '20px 0', border: 'none', borderTop: '1px solid #ddd' }} />

              <h3>2. Tone (emotional – optional, pick 0–1)</h3>
              <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
                <li style={{ marginBottom: '8px' }}>
                  <strong>Dark</strong> → heavy, ominous, sinister
                </li>
                <li style={{ marginBottom: '8px' }}>
                  <strong>Bright</strong> → uplifting, cheerful, radiant
                </li>
                <li style={{ marginBottom: '8px' }}>
                  <strong>Melancholic</strong> → bittersweet, longing, sad
                </li>
                <li style={{ marginBottom: '8px' }}>
                  <strong>Dreamy</strong> → hazy, ethereal, floaty
                </li>
                <li style={{ marginBottom: '8px' }}>
                  <strong>Nostalgic</strong> → retro, familiar, past-evoking
                </li>
                <li style={{ marginBottom: '8px' }}>
                  <strong>Neutral</strong> → no strong emotional tilt
                </li>
              </ul>

              <hr style={{ margin: '20px 0', border: 'none', borderTop: '1px solid #ddd' }} />

              <h3>3. Energy (intensity – pick 1, mandatory)</h3>
              <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
                <li style={{ marginBottom: '8px' }}>
                  <strong>Low</strong> → meditative, soft, relaxed
                </li>
                <li style={{ marginBottom: '8px' }}>
                  <strong>Medium</strong> → steady, moderate drive
                </li>
                <li style={{ marginBottom: '8px' }}>
                  <strong>High</strong> → intense, fast, physical
                </li>
              </ul>

              <hr style={{ margin: '20px 0', border: 'none', borderTop: '1px solid #ddd' }} />

              <h3>4. Examples</h3>
              <ul style={{ fontSize: '14px' }}>
                <li style={{ marginBottom: '5px' }}>
                  Slow dub set → <em>Sedative | Dreamy | Low</em>
                </li>
                <li style={{ marginBottom: '5px' }}>
                  Disco-house mix → <em>Club | Bright/Nostalgic | Medium</em>
                </li>
                <li style={{ marginBottom: '5px' }}>
                  Harsh noise show → <em>Hard | Dark | High</em>
                </li>
                <li style={{ marginBottom: '5px' }}>
                  Spoken word + field recordings → <em>Research | Neutral | Low</em>
                </li>
              </ul>

              <hr style={{ margin: '20px 0', border: 'none', borderTop: '1px solid #ddd' }} />

              <div
                style={{
                  backgroundColor: '#E8F5E9',
                  padding: '15px',
                  borderRadius: '4px',
                  border: '1px solid #C8E6C9',
                }}
              >
                <h3 style={{ marginTop: 0 }}>✅ Classification Rules</h3>
                <ul style={{ marginBottom: 0, fontSize: '14px' }}>
                  <li>
                    Always pick <strong>1 Energy</strong>
                  </li>
                  <li>
                    Then pick <strong>at least one</strong> between <strong>Mood</strong> or{' '}
                    <strong>Tone</strong>
                  </li>
                  <li>
                    Best practice: choose <strong>Mood + Tone</strong> for richer tagging
                  </li>
                  <li>If unsure: Energy + Tone is enough</li>
                  <li>
                    Choose <strong>at least 2 genres</strong>
                  </li>
                </ul>
              </div>

              <div style={{ marginTop: '20px', textAlign: 'center' }}>
                <button
                  onClick={() => setShowClassificationModal(false)}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: '#28a745',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: 'bold',
                  }}
                >
                  Got it
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default EpisodeUploadView
