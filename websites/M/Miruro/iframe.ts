const iframe = new iFrame()

iframe.on('UpdateData', async () => {
  const video = document.querySelector('video')

  if (!video)
    return

  if (!Number.isFinite(video.duration) || video.duration <= 0)
    return

  iframe.send({
    video: {
      currentTime: video.currentTime,
      duration: video.duration,
      paused: video.paused,
    },
  })
})