import { ActivityType, Assets, getTimestamps } from 'premid'

const presence = new Presence({
  clientId: '1541121134664097902',
})

enum ActivityAssets {
  Logo = 'https://www.miruro.to/assets/logo-Dnw3w3dS.png?v=1.12.0',
}

let iframeData: {
  video?: {
    currentTime?: number
    duration?: number
    paused?: boolean
  }
  receivedAt?: number
} = {}

let cachedAnimeId: string | undefined
let cachedAnimeCover: string | undefined

let lastEpisodeNumber: string | undefined
let lastEpisodeTitle: string | undefined
let lastEpisodeDescription: string | undefined

presence.on('iFrameData', (data) => {
  iframeData = {
    ...data,
    receivedAt: Date.now(),
  }
})

/**
 * Extract just the anime title, avoiding sibling elements
 * (badges, status pills, score, etc.) that Miruro nests inside
 * or beside the same heading container.
 *
 * Strategy: prefer a dedicated title node if Miruro exposes one
 * (data-testid / class hook), otherwise fall back to the h1 but
 * only take its OWN direct text nodes, not descendant elements.
 */
function getAnimeTitle(): string | undefined {
  // Miruro renders the title inside a heavily nested h1, e.g.:
  //   <h1 class="_infoMobileTitle_...">
  //     <div class="_wrapper_...">
  //       <div class="_content_...">
  //         <div class="_infoEllipsizedLines3_...">Noragami</div>
  //   ...plus a sibling <svg> overlay with unrelated content.
  //
  // The innermost "_infoEllipsizedLinesN_" div holds just the
  // title text, so target that class fragment directly instead
  // of reading the whole h1's textContent (which used to also
  // capture the svg's <title> and other nested nodes).
  const ellipsized = document.querySelector<HTMLElement>(
    'h1 [class*="_infoEllipsizedLines"]',
  )

  if (ellipsized?.textContent?.trim()) {
    return ellipsized.textContent.trim()
  }

  // Fallback: h1's own direct text nodes only (skips nested
  // elements entirely, in case the class above ever changes).
  const h1 = document.querySelector('h1')

  if (h1) {
    const ownText = [...h1.childNodes]
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent)
      .join('')
      .trim()

    if (ownText) {
      return ownText
    }
  }

  return undefined
}

presence.on('UpdateData', async () => {
  const { pathname, search } = document.location
  // ─────────────────────────────────────────────
  // ANIME INFO PAGE
  // ─────────────────────────────────────────────

  const infoMatch = pathname.match(/^\/info\/(\d+)/)

  if (infoMatch) {
    const animeId = infoMatch[1]

    const animeTitle =
      getAnimeTitle() ||
      document.title
        .replace(' · Miruro', '')
        .trim()

    const animeCover = [...document.querySelectorAll<HTMLImageElement>(
      'img[src*="anilistcdn"]',
    )]
      .map(img => img.src)
      .find(src => {
        const coverPattern = new RegExp(
          `/media/anime/cover/large/(?:b|n)x${animeId}-`,
          'i',
        )

        return coverPattern.test(src)
      })

    const infoPresence: PresenceData = {
      type: ActivityType.Watching,
      name: 'Miruro',
      details: animeTitle || 'Browsing...',
      state: 'Browsing...',
      statusDisplayType: 1,
      largeImageKey: animeCover || ActivityAssets.Logo,
      largeImageText: 'Browsing...',
    }

    presence.setActivity(infoPresence)
    return
  }

  // ─────────────────────────────────────────────
  // GENERAL BROWSING
  // ─────────────────────────────────────────────

  if (!pathname.startsWith('/watch/')) {
    const browsingPresence: PresenceData = {
      type: ActivityType.Watching,
      name: '\u200B',
      details: 'Miruro',
      state: 'Browsing...',
      statusDisplayType: 1,
      largeImageKey: ActivityAssets.Logo,
      largeImageText: 'Miruro',
    }

    presence.setActivity(browsingPresence)
    return
  }

  const params = new URLSearchParams(search)
  const episodeNumber = params.get('ep') || undefined
  const animeId = pathname.match(/^\/watch\/(\d+)/)?.[1]

  // Reset anime-specific cache when changing anime.
  if (animeId !== cachedAnimeId) {
    cachedAnimeId = animeId
    cachedAnimeCover = undefined
  }

  // Find the AniList cover.
  // AniList image URLs use bx<ID>-... or nx<ID>-...
  if (animeId && !cachedAnimeCover) {
    const coverPattern = new RegExp(
      `/media/anime/cover/large/(?:b|n)x${animeId}-`,
      'i',
    )

    cachedAnimeCover = [...document.querySelectorAll<HTMLImageElement>(
      'img[src*="anilistcdn"]',
    )]
      .map(img => img.src)
      .find(src => coverPattern.test(src))
  }

  // Current season.
  // Returns undefined when Miruro does not show a season selector.
  const currentSeason =
    document
      .querySelector('a[class*="_isCurrent_"]')
      ?.textContent
      ?.trim() || undefined

  // Episode information.
  let episodeTitle: string | undefined
  let episodeDescription: string | undefined

  if (episodeNumber) {
    const episodePattern = new RegExp(
      `^EP\\s*${episodeNumber}\\s*:`,
      'i',
    )

    const episodeButton = [...document.querySelectorAll<HTMLButtonElement>(
      'button[title]',
    )].find(button =>
      episodePattern.test(button.getAttribute('title') || ''),
    )

    if (episodeButton) {
      const title = episodeButton.getAttribute('title')

      if (title) {
        episodeTitle = title
          .replace(
            new RegExp(
              `^EP\\s*${episodeNumber}\\s*:\\s*`,
              'i',
            ),
            '',
          )
          .trim()
      }

      // Scope the description search to an element actually
      // inside this specific episode button/card, not any
      // "_description_"-classed element anywhere on the page
      // (Miruro reuses that class name for the anime synopsis
      // too, which is what was leaking into `state`).
      const episodeCard =
        episodeButton.closest(
          '[class*="_episodeItem_"], [class*="_episode_"], li, [role="listitem"]',
        ) || episodeButton

      episodeDescription =
        episodeCard
          .querySelector('[class*="_description_"]')
          ?.textContent
          ?.trim() || undefined
    }
  }

  // Detect an episode change.
  if (episodeNumber !== lastEpisodeNumber) {
    lastEpisodeNumber = episodeNumber
    lastEpisodeTitle = undefined
    lastEpisodeDescription = undefined

    // Discard playback data from the previous episode.
    iframeData = {}
  }

  // Keep the last valid episode information while Miruro
  // is still rendering the new episode.
  if (episodeTitle) {
    lastEpisodeTitle = episodeTitle
  }

  if (episodeDescription) {
    lastEpisodeDescription = episodeDescription
  }

  // During a fast SPA episode switch, Miruro may briefly have
  // the URL updated before the episode button is rendered.
  // Don't replace a valid activity with incomplete data.
  if (episodeNumber && !lastEpisodeTitle) {
    return
  }

  const animeTitle =
    getAnimeTitle() ||
    document.title
      .replace(' · Miruro', '')
      .replace('Watch ', '')
      .trim()

  const presenceData: PresenceData = {
    type: ActivityType.Watching,

    name: animeTitle || '\u200B',

    details:
      lastEpisodeTitle ||
      (episodeNumber
        ? `Episode ${episodeNumber}`
        : '\u200B'),

    state:
      lastEpisodeDescription ||
      '\u200B',

    largeImageKey:
      cachedAnimeCover ||
      ActivityAssets.Logo,

    largeImageText:
      currentSeason && episodeNumber
        ? `${currentSeason}, Episode ${episodeNumber}`
        : episodeNumber
          ? `Episode ${episodeNumber}`
          : 'Miruro',
  }

  // Playback information from strm.cx.
  if (
    iframeData.video &&
    iframeData.receivedAt &&
    Date.now() - iframeData.receivedAt < 5000
  ) {
    const {
      currentTime,
      duration,
      paused,
    } = iframeData.video

    if (
      currentTime !== undefined &&
      duration !== undefined &&
      Number.isFinite(currentTime) &&
      Number.isFinite(duration) &&
      duration > 0 &&
      currentTime >= 0
    ) {
      if (paused) {
        presenceData.smallImageKey = Assets.Pause
        presenceData.smallImageText = 'Paused'
      }
      else {
        presenceData.smallImageKey = Assets.Play
        presenceData.smallImageText = 'Playing'

        ;[
          presenceData.startTimestamp,
          presenceData.endTimestamp,
        ] = getTimestamps(currentTime, duration)
      }
    }
  }

  presence.setActivity(presenceData)
})