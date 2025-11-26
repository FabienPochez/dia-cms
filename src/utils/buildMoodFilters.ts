/**
 * Build mood/tone/energy filter where clause from query parameters
 * 
 * Normalizes and validates query params, then builds Payload where clause conditions.
 * Returns null if no valid filters are present.
 * 
 * @param query - Request query params (from req.query)
 * @returns Partial where clause object to merge (no top-level 'and' wrapping), or null if no filters
 * 
 * NOTE: Allowed values must match Episodes collection field config (src/collections/Episodes.ts):
 * - mood: lines 152-166 (options array, exclude empty string value)
 * - tone: lines 169-179 (options array)
 * - energy: line 150 (options array)
 */

// Allowed values - MUST match Episodes collection field config (source of truth)
// See src/collections/Episodes.ts for the canonical definitions
const ALLOWED_MOODS = [
  'sedative',
  'cozy',
  'groovy',
  'club',
  'adrenaline',
  'hard',
  'psychedelic',
  'leftfield',
  'research',
] as const

const ALLOWED_TONES = [
  'dark',
  'bright',
  'melancholic',
  'dreamy',
  'nostalgic',
  'neutral',
] as const

const ALLOWED_ENERGIES = ['low', 'medium', 'high'] as const

type AllowedMood = (typeof ALLOWED_MOODS)[number]
type AllowedTone = (typeof ALLOWED_TONES)[number]
type AllowedEnergy = (typeof ALLOWED_ENERGIES)[number]

/**
 * Normalize a value: trim, lowercase, and validate against allowed list
 */
function normalizeValue(
  value: string | string[] | undefined,
  allowedValues: readonly string[],
): string[] {
  if (!value) return []

  // Normalize to array
  const values = Array.isArray(value) ? value : [value]

  // Normalize each value: trim, lowercase, filter invalid
  return values
    .map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : ''))
    .filter((v) => v && allowedValues.includes(v))
}

/**
 * Extract and normalize mood values from query
 */
function extractMoods(query: Record<string, unknown>): string[] {
  const moods = normalizeValue(query.mood as string | string[] | undefined, ALLOWED_MOODS)
  // Filter out empty strings (mood can be '' in DB, but we don't want to match it)
  return moods.filter((m) => m !== '')
}

/**
 * Extract and normalize tone values from query
 */
function extractTones(query: Record<string, unknown>): string[] {
  return normalizeValue(query.tone as string | string[] | undefined, ALLOWED_TONES)
}

/**
 * Extract and normalize toneNot values from query
 */
function extractToneNots(query: Record<string, unknown>): string[] {
  return normalizeValue(query.toneNot as string | string[] | undefined, ALLOWED_TONES)
}

/**
 * Extract and normalize energy values from query
 */
function extractEnergies(query: Record<string, unknown>): string[] {
  return normalizeValue(query.energy as string | string[] | undefined, ALLOWED_ENERGIES)
}

export function buildMoodFilters(
  query: Record<string, unknown>,
): Record<string, unknown> | null {
  const moods = extractMoods(query)
  const energies = extractEnergies(query)
  const tones = extractTones(query)
  const toneNots = extractToneNots(query)

  // If all filters are empty after normalization, return null (no filters)
  if (moods.length === 0 && energies.length === 0 && tones.length === 0 && toneNots.length === 0) {
    return null
  }

  // Build partial where clause object (no top-level 'and' wrapping)
  // Multiple top-level keys are AND-ed together by Payload
  const whereClause: Record<string, unknown> = {}

  // Mood filter: mood must be in the provided array
  if (moods.length > 0) {
    whereClause.mood = {
      in: moods,
    }
  }

  // Energy filter: energy must be in the provided array
  if (energies.length > 0) {
    whereClause.energy = {
      in: energies,
    }
  }

  // Handle tone and toneNot filters
  // When both are provided, both must apply (AND):
  // - tone filter: (tone in allowedTones) OR (tone does not exist)
  // - toneNot filter: if tone exists, it MUST NOT be in toneNot[]
  if (tones.length > 0 && toneNots.length > 0) {
    // Combined case: wrap tone conditions in 'and' array
    // This is the only case where we use 'and' - for combining tone and toneNot
    const toneConditions: Record<string, unknown>[] = [
      {
        tone: {
          or: [
            { in: tones },
            { exists: false },
          ],
        },
      },
      {
        tone: {
          not_in: toneNots,
        },
      },
    ]
    // If we have other conditions (mood, energy), add them to top level and wrap tone in 'and'
    if (Object.keys(whereClause).length > 0) {
      whereClause.and = toneConditions
    } else {
      // Only tone conditions, so we can use 'and' at top level
      return { and: toneConditions }
    }
  } else if (tones.length > 0) {
    // Tone filter only: tone must be in the provided array OR tone does not exist (null/undefined)
    whereClause.tone = {
      or: [
        {
          in: tones,
        },
        {
          exists: false,
        },
      ],
    }
  } else if (toneNots.length > 0) {
    // ToneNot filter only: if tone exists, it must NOT be in the toneNot array
    // Episodes with tone = null pass this filter
    whereClause.tone = {
      not_in: toneNots,
    }
  }

  // If no conditions were built, return null
  if (Object.keys(whereClause).length === 0) {
    return null
  }

  // Return partial where clause (hook will merge with existing where using 'and')
  return whereClause
}

