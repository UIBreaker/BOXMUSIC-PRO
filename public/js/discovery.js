// Preview only starts playback. Saving remains an explicit download action.
(function (root) {
  const trackId = (id) => String(id || '').replace(/^yt_/, '');

  function isSameTrack(first, second) {
    return !!first && !!second && !!trackId(first.id) && trackId(first.id) === trackId(second.id);
  }

  function preview(item, librarySongs, player, apiBase) {
    if (isSameTrack(item, player.getCurrentSong())) {
      player.togglePlay();
      return;
    }
    const saved = librarySongs.find((song) => song.id === `yt_${trackId(item.id)}`);
    player.setQueue([saved || {
      ...item,
      id: `yt_${trackId(item.id)}`,
      streamUrl: `${apiBase}/api/download?id=${encodeURIComponent(trackId(item.id))}`,
      source: 'youtube',
      isPreview: true,
      favorite: false
    }], 0, true);
  }

  const discovery = { isSameTrack, preview };
  if (typeof module !== 'undefined' && module.exports) module.exports = discovery;
  else root.Discovery = discovery;
})(typeof window === 'undefined' ? this : window);
