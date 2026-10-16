// Shared collection calculations; no audio blobs or playlist records are changed.
(function (root) {
  const normalize = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLocaleLowerCase('vi');

  function songsFor(playlist, songMap) {
    return (playlist.songIds || []).map((id) => songMap.get(id)).filter(Boolean);
  }

  function durationLabel(songs) {
    let known = 0;
    const seconds = songs.reduce((total, song) => {
      let value = Number(song.seconds);
      if (!Number.isFinite(value) || value <= 0) {
        const parts = String(song.duration || '').split(':');
        value = parts.length >= 2 && parts.length <= 3 && parts.every((part) => /^\d+$/.test(part))
          ? parts.reduce((sum, part) => sum * 60 + Number(part), 0) : 0;
      }
      if (value > 0 && Number.isFinite(value)) { known++; return total + value; }
      return total;
    }, 0);
    if (!known) return '';
    const minutes = Math.max(1, Math.round(seconds / 60));
    const label = minutes >= 60 ? `${Math.floor(minutes / 60)} giờ${minutes % 60 ? ` ${minutes % 60} phút` : ''}` : `${minutes} phút`;
    return known < songs.length ? `ít nhất ${label}` : label;
  }

  function select(playlists, query, sort, songMap) {
    const needle = normalize(query).trim();
    return playlists.filter((pl) => normalize(pl.name).includes(needle)).slice().sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name, 'vi');
      if (sort === 'songs') return songsFor(b, songMap).length - songsFor(a, songMap).length || (b.createdAt || 0) - (a.createdAt || 0);
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  function palette(id) {
    return Array.from(String(id)).reduce((hash, char) => (hash + char.charCodeAt(0)) % 5, 0);
  }

  const utils = { songsFor, durationLabel, select, palette };
  if (typeof module !== 'undefined' && module.exports) module.exports = utils;
  else root.PlaylistUI = utils;
})(typeof window === 'undefined' ? this : window);
