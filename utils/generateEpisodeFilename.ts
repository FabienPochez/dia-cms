export function generateEpisodeFilename({
  id,
  show,
  title,
  episodeNumber,
}: {
  id: string
  show?: { slug?: string; title?: string } | null
  title: string
  episodeNumber: number
}): string {
  const slugify = (str: string) =>
    str
      ?.normalize('NFD') // decompose accents
      .replace(/[\u0300-\u036f]/g, '') // remove diacritics
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-') // replace non-alphanum with dash
      .replace(/(^-|-$)/g, '') || 'untitled' // trim leading/trailing dashes

  // Always use show.title for consistency, ignoring corrupted show.slug
  const showSlug = show?.title ? slugify(show.title) : slugify(title)
  console.log(`🎯 Generating filename for episode ${id} with show:`, show)
  console.log(`   showSlug computed from title: "${showSlug}"`)

  const titleSlug = slugify(title)

  return `${id}__${showSlug}__${titleSlug}__${episodeNumber}.mp3`
}
