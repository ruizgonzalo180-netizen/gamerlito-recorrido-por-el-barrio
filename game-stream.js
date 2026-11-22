/* Local HLS playback for the complete recording. The cover and studio ident use native MP4. */
function createGameStream(video, onReady, onFailure) {
  const master = 'media/master.m3u8';
  const hd = 'media/hd/index.m3u8';
  const nativeHls = Boolean(video.canPlayType('application/vnd.apple.mpegurl'));
  const useHlsJs = window.Hls && Hls.isSupported() &&
    !(nativeHls && navigator.vendor === 'Apple Computer, Inc.');
  let state = 'idle';
  let revision = 0;
  let player = null;
  let aborter = null;
  let objectUrl = null;
  let resumeAt = 0;
  let useHd = false;

  function release() {
    revision++;
    state = 'idle';
    if (aborter) aborter.abort();
    aborter = null;
    if (player) player.destroy();
    player = null;
    if (video.hasAttribute('src')) {
      video.removeAttribute('src');
      video.load();
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }

  // Older MP4 browsers without HLS or MediaSource can play the same fragmented
  // H.264 file after the complete init segment and media fragments are loaded.
  async function loadAsFile(signal) {
    const playlist = new URL(hd, document.baseURI);
    const response = await fetch(playlist, {signal});
    if (!response.ok) throw new Error('Playlist unavailable');
    const text = await response.text();
    const init = text.match(/^#EXT-X-MAP:URI="([^"]+)"/m);
    const parts = text.split(/\r?\n/).filter(line => line && !line.startsWith('#'));
    if (!init || !parts.length) throw new Error('Incomplete playlist');
    const buffers = [];
    for (const name of [init[1], ...parts]) {
      const part = await fetch(new URL(name, playlist), {signal});
      if (!part.ok) throw new Error('Video fragment unavailable');
      buffers.push(await part.blob());
    }
    return new Blob(buffers, {type:'video/mp4'});
  }

  function fail(id) {
    if (id !== revision || state === 'idle' || state === 'failed') return;
    resumeAt = video.currentTime || resumeAt;
    if (!useHd && (useHlsJs || nativeHls)) {
      release();
      useHd = true;
      load();
    } else {
      state = 'failed';
      onFailure();
    }
  }

  function load() {
    const id = ++revision;
    state = 'loading';
    const url = useHd ? hd : master;
    if (useHlsJs) {
      player = new Hls({startLevel:0, capLevelToPlayerSize:true, maxBufferLength:15});
      player.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) fail(id); });
      player.loadSource(url);
      player.attachMedia(video);
    } else if (nativeHls) {
      video.src = url;
      video.load();
    } else if (video.canPlayType('video/mp4')) {
      aborter = new AbortController();
      loadAsFile(aborter.signal).then(blob => {
        if (id !== revision) return;
        objectUrl = URL.createObjectURL(blob);
        video.src = objectUrl;
      }).catch(() => fail(id));
    } else {
      fail(id);
    }
  }

  video.addEventListener('loadedmetadata', () => {
    if (state !== 'loading') return;
    state = 'ready';
    if (resumeAt > 0) {
      video.currentTime = resumeAt;
      resumeAt = 0;
    }
    onReady();
  });
  video.addEventListener('error', () => {
    if (video.error && (!useHlsJs || !player)) fail(revision);
  });

  return {
    prepare() {
      if (state === 'idle') load();
      if (state === 'failed') onFailure();
      return state === 'ready';
    },
    retry() {
      if (state === 'failed' || video.error) {
        resumeAt = video.currentTime || resumeAt;
        release();
      }
    },
    reset() {
      if (state !== 'idle') release();
      useHd = false;
      resumeAt = 0;
    }
  };
}
