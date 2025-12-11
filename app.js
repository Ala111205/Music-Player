import {
  openDB,
  addSongToDB,
  getAllSongsFromDB,
  deleteSongFromDB,
  updateSongInDB,
  getHistory,
  addFavorite,
  removeFavorite,
  getFavorites,
  resetSongsDB
} from "./db.js";

/* ====================== DOM ELEMENTS ====================== */
const audio = document.getElementById("audio");
const title = document.getElementById("title");
const artist = document.getElementById("artist");
const cover = document.getElementById("cover");
const progress = document.getElementById("progress");
const current = document.getElementById("current");
const duration = document.getElementById("duration");
const playBtn = document.getElementById("play");
const prevBtn = document.getElementById("prev");
const nextBtn = document.getElementById("next");
const repeatBtn = document.getElementById("repeat");
const loopBtn = document.getElementById("loop-toggel");
const volume = document.getElementById("volume");
const speed = document.getElementById("speed");
const playlistUI = document.getElementById("playlist");
const upload = document.getElementById("upload");
const searchInput = document.getElementById("search");
const showFavoritesBtn = document.getElementById("show-favorites");
const showHistoryBtn = document.getElementById("show-history");
const smartShuffleBtn = document.getElementById("smart-shuffle");
const chooseFolderBtn = document.getElementById("chooseFolder");
const folderUpload = document.getElementById("folderUpload");
const lyricsDisplay = document.getElementById("lyrics-display");
const visualizerCanvas = document.getElementById("visualizer");
const favoriteModal = document.querySelector(".fav-container");
const closeFavorite = document.getElementById("close-favorite");
const historyModal = document.getElementById("history-modal");
const historyList = document.getElementById("history-list");
const closeHistory = document.getElementById("close-history");

/* ====================== AUDIO SRC HELPER ====================== */
let currentBlobUrl = null;
function setAudioSrc(source) {
  if (currentBlobUrl) {
    URL.revokeObjectURL(currentBlobUrl);
    currentBlobUrl = null;
  }

  if (source instanceof Blob) {
    currentBlobUrl = URL.createObjectURL(source);
    audio.src = currentBlobUrl;
  } else if (typeof source === "string") {
    audio.src = source;
  } else {
    console.error("Invalid audio source:", source);
  }

  audio.load();
}

/* ====================== STATE ====================== */
let songs = [];
let index = 0;
let repeat = false;
let shuffle = false;
let smartShuffle = false;
let analyser, audioCtx, sourceNode;
let lyricLines = [];
let lyricTimer = null;
let vizAnimationId = null;

/* ====================== UTILS ====================== */
const format = t => !t ? "0:00" : Math.floor(t/60)+":"+Math.floor(t%60).toString().padStart(2,"0");
const escapeHtml = s => s.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);

/* ====================== DATABASE ====================== */
export async function storeSong(input, folder = null) {
  if (!input) {
    console.error("storeSong called with empty input");
    return;
  }

  let blob = null;
  let name = null;
  let type = null;

  // From <input type="file">
  if (input instanceof File) {
    name = input.name;
    type = input.type;
    blob = new Blob([await input.arrayBuffer()], { type });
  }

  // From folder upload object
  else if (input.blob && input.name) {
    name = input.name;
    type = input.blob.type;
    blob = input.blob;
    folder = input.folder || folder;
  }

  else {
    console.error("Invalid input:", input);
    return;
  }

  if (!name || !blob) {
    console.error("Invalid song data", { name, blob });
    return;
  }

  const validExtensions = ["mp3", "wav", "ogg", "m4a"];
  const ext = name.split('.').pop().toLowerCase();

  if (!type.startsWith("audio/") && !validExtensions.includes(ext)) {
    console.warn("Skipped non-audio:", name);
    return;
  }

  const existing = await getAllSongsFromDB();

  const cleanedName = name.replace(/\.[^/.]+$/, "");

  const isDuplicate = existing.some(s =>
    s.name === cleanedName &&
    s.folder === folder
  );

  if (isDuplicate) {
    console.warn("Duplicate skipped:", name);
    return;
  }

  const song = {
    name: cleanedName,
    artist: "Local",
    blob,
    cover: null,
    favorite: false,
    playCount: 0,
    lastPlayed: null,
    folder
  };

  await addSongToDB(song);

  console.log("Stored:", song.name, "| Folder:", folder);
}

function isDuplicate(existingSongs, file) {
  return existingSongs.some(s =>
    s.name === file.name &&
    s.folder === (file.webkitRelativePath?.split("/")[0] || null)
  );
}

/* ====================== PLAYBACK ====================== */
let currentBlobURL = null;

async function playSongAtIndex(i) {
  try {
    if (!songs[i]) return;

    index = i;
    const song = songs[i];

    console.log("Attempting to play:", song.name);

    let sourceBlob = (song.blob instanceof Blob) ? song.blob : null;

    // HARD VALIDATION for MAIN LIST entry
    const validMainBlob =
      sourceBlob &&
      sourceBlob.size > 0 &&
      sourceBlob.type.startsWith("audio/");

    // FALLBACK to FAVORITES snapshot ONLY IF main entry has no valid blob
    if (!validMainBlob) {
      try {
        const favs = await getFavorites();
        const snap = favs.find(f => f.songId === song.id);

        if (snap && snap.blob instanceof Blob) {
          if (snap.blob.size > 0 && snap.blob.type.startsWith("audio/")) {
            sourceBlob = snap.blob;
          }
        }
      } catch (e) {
        console.warn("Favorites fallback failed:", e);
      }
    }

    // FINAL VALIDATION — if STILL no valid blob → stop
    if (
      !sourceBlob ||
      sourceBlob.size === 0 ||
      !sourceBlob.type.startsWith("audio/")
    ) {
      alert(`${song.name} cannot be played (no valid audio data).`);
      console.error("Invalid final blob for:", song.name, sourceBlob);
      return;
    }

    // Reset previous URL
    if (currentBlobURL) {
      URL.revokeObjectURL(currentBlobURL);
      currentBlobURL = null;
    }

    audio.pause();
    audio.currentTime = 0;

    // Build URL
    currentBlobURL = URL.createObjectURL(sourceBlob);
    audio.src = currentBlobURL;
    audio.load();

    // Update UI
    title.innerText = song.name || "Unknown";
    artist.innerText = song.artist || "Unknown";
    cover.src = song.cover && song.cover.trim() !== "" ? song.cover : "assets/cover/default.jpg";

    // Update DB for main entries ONLY
    if (!song.isVirtual && song.id) {
      try {
        await updateSongInDB(song.id, {
          lastPlayed: Date.now(),
          playCount: (song.playCount || 0) + 1
        });
      } catch (e) {
        console.warn("DB update failed:", e);
      }
    }

    // Play
    await audio.play();
    startVisualizer();
    playBtn.innerText = "⏸";

    if (song.lyrics) parseAndDisplayLyrics(song.lyrics);
    else clearLyricsDisplay();

  } catch (err) {
    console.error("Playback failed:", err);
  }
}

async function playSongById(songId) {
  if (!songId) return;

  // Find song in current playlist
  let idx = songs.findIndex(s => s.id === songId);
  let song = songs[idx];

  // If not found → check favorites for a virtual entry
  if (!song) {
    try {
      const favs = await getFavorites();
      const snap = favs.find(f => f.songId === songId);
      if (!snap) {
        console.error("Song not found anywhere:", songId);
        alert("This song is not in your playlist or favorites.");
        return;
      }

      // Create virtual song entry
      song = {
        id: snap.songId,
        name: snap.name,
        artist: snap.artist,
        cover: snap.cover || null,
        url: snap.url,
        blob: snap.blob instanceof Blob ? snap.blob : null,
        isVirtual: true
      };

      songs.unshift(song);
      await loadPlaylist(""); // re-render playlist UI
      idx = 0;
    } catch (e) {
      console.error("Failed to load favorite snapshot:", e);
      return;
    }
  }

  // Scroll UI to current song
  const el = playlistUI.querySelector(`li[data-id="${song.id}"]`);
  if (el) scrollElementToCenter(playlistUI, el);

  // Delegate to playSongAtIndex
  await playSongAtIndex(idx);
}

function nextSong() {
  if (!songs.length) return;
  if (smartShuffle) {
    const choice = pickSmartNext();
    const idx = songs.findIndex(s => s.id === choice.id);
    if(idx>=0){ index=idx; playSongAtIndex(index); return; }
  }
  index = shuffle ? Math.floor(Math.random()*songs.length) : (index+1)%songs.length;
  playSongAtIndex(index);
}

function prevSong() {
  if (!songs.length) return;
  index = (index-1+songs.length)%songs.length;
  playSongAtIndex(index);
}

/* ====================== SMART SHUFFLE ====================== */
function pickSmartNext() {
  const favs = songs.filter(s=>s.favorite);
  if(favs.length && Math.random()<0.6) return favs[Math.floor(Math.random()*favs.length)];
  let total = songs.reduce((acc,s)=>acc+1/((s.playCount||1)),0);
  let r = Math.random()*total;
  for(const s of songs){
    r -= 1/((s.playCount||1));
    if(r<=0) return s;
  }
  return songs[Math.floor(Math.random()*songs.length)];
}

/* ====================== PLAYLIST ====================== */
async function loadPlaylist(filter = "") {
  const [allSongs, favSnapshots] = await Promise.all([
    getAllSongsFromDB(),
    getFavorites()
  ]);

  /* -----------------------------------------
     FAVORITE ID SET
  ----------------------------------------- */
  const favoriteIDs = new Set(favSnapshots.map(f => f.songId));

  /* -----------------------------------------
     VALID MAIN SONGS ONLY
  ----------------------------------------- */
  const validSongs = [];
  for (const s of allSongs) {
    const isValid =
      s &&
      typeof s.name === "string" &&
      (
        (s.blob instanceof Blob && s.blob.size > 0) ||
        typeof s.url === "string"
      );

    if (!isValid) {
      if (s?.id) await deleteSongFromDB(s.id);
      continue;
    }
    validSongs.push(s);
  }

  /* -----------------------------------------
     MISSING FAVORITES → VIRTUAL SNAPSHOT ENTRIES
  ----------------------------------------- */
  const missingFavs = favSnapshots
    .filter(f => !validSongs.some(s => s.id === f.songId))
    .map(f => ({
      id: f.songId,
      name: f.name,
      artist: f.artist,
      cover: f.cover,
      url: (typeof f.url === "string" && f.url) ? f.url : null,
      blob: (f.blob instanceof Blob) ? f.blob : null,
      isVirtual: true
    }));

  /* -----------------------------------------
     COMBINE SONGS
  ----------------------------------------- */
  let combined = [...validSongs, ...missingFavs];

  /* -----------------------------------------
     SEARCH FILTER
  ----------------------------------------- */
  if (filter) {
    const q = filter.toLowerCase();
    combined = combined.filter(
      s =>
        s.name?.toLowerCase().includes(q) ||
        s.artist?.toLowerCase().includes(q)
    );
  }

  songs = combined;

  /* -----------------------------------------
     BUILD UI
  ----------------------------------------- */
  playlistUI.innerHTML = "";

  songs.forEach(song => {
    const li = document.createElement("li");
    li.className = "song-item";
    li.dataset.id = song.id;

    const title = document.createElement("span");
    title.textContent = `${song.name} — ${song.artist || "Unknown"}`;
    li.appendChild(title);

    const group = document.createElement("div");

    /* -----------------------------------------
       FAVORITE BUTTON
    ----------------------------------------- */
    const favBtn = document.createElement("button");
    const updateFavUI = () => {
      favBtn.textContent = favoriteIDs.has(song.id) ? "★" : "☆";
    };
    updateFavUI();

    favBtn.onclick = async e => {
      e.stopPropagation();

      if (favoriteIDs.has(song.id)) {
        await removeFavorite(song.id);
        favoriteIDs.delete(song.id);
      } else {
        // DB requires full song object, so supply full entry
        await addFavorite(song);
        favoriteIDs.add(song.id);
      }

      updateFavUI();
    };
    group.appendChild(favBtn);

    /* -----------------------------------------
       LYRICS
    ----------------------------------------- */
    const lyrBtn = document.createElement("button");
    lyrBtn.textContent = "Lyrics";
    lyrBtn.onclick = e => {
      e.stopPropagation();
      song.lyrics
        ? parseAndDisplayLyrics(song.lyrics)
        : (lyricsDisplay.innerText = "No lyrics.");
    };
    group.appendChild(lyrBtn);

    /* -----------------------------------------
       DELETE
    ----------------------------------------- */
    const delBtn = document.createElement("button");
    delBtn.textContent = "Delete";
    delBtn.onclick = async e => {
      e.stopPropagation();
      await deleteSongFromDB(song.id);
      li.remove();

      songs = songs.filter(s => s.id !== song.id);
      repeatBtn.disabled = songs.length <= 1;
    };
    group.appendChild(delBtn);

    li.appendChild(group);

    /* -----------------------------------------
       PLAY / ONCLICK
    ----------------------------------------- */
    li.onclick = () => {
      const idx = songs.findIndex(s => s.id === song.id);
      if (idx < 0) return;

      const entry = songs[idx];
      if (!(entry.blob instanceof Blob) && !entry.url) {
        alert("This favorite snapshot has no stored audio (original file deleted).");
        return;
      }

      playSongById(song.id);
    };

    playlistUI.appendChild(li);
  });

  repeatBtn.disabled = songs.length <= 1;

  /* -----------------------------------------
     CENTER CURRENT SONG IN VIEW
  ----------------------------------------- */
  if (songs[index]) {
    const el = playlistUI.querySelector(`li[data-id="${songs[index].id}"]`);
    if (el) scrollElementToCenter(playlistUI, el);
  }
}

function scrollElementToCenter(container, element) {
  const containerHeight = container.clientHeight;
  const elementTop = element.offsetTop;
  const elementHeight = element.clientHeight;

  const scrollPosition =
    elementTop - (containerHeight / 2) + (elementHeight / 2);

  container.scrollTo({
    top: scrollPosition,
    behavior: "smooth"
  });
}

async function showFavoritesInCanvas() {
  const favs = await getFavorites();
  const box = document.getElementById("fav-canvas-list");
  if (!box) return;

  box.innerHTML = "";

  if (!favs.length) {
    box.innerHTML = "<p>No favorites yet.</p>";
    favoriteModal.classList.remove("hidden");
    return;
  }

  favs.forEach(f => {
    const row = document.createElement("div");
    row.className = "fav-item";

    const title = document.createElement("span");
    title.className = "fav-title";
    title.textContent = `${f.name} — ${f.artist || "Unknown"}`;

    title.onclick = async () => {
      const idx = songs.findIndex(s => s.id === f.songId);

      if (idx !== -1) {
        playSongById(f.songId);
      } else {
        // inject virtual playable entry
        const virtual = {
          id: f.songId,
          name: f.name,
          artist: f.artist,
          cover: f.cover,
          url: f.url,
          blob: null,
          isVirtual: true
        };
        songs.unshift(virtual);

        await loadPlaylist("");
        playSongAtIndex(0);
      }

      favoriteModal.classList.add("hidden");
    };

    const removeBtn = document.createElement("button");
    removeBtn.innerHTML = `<i class="fa-solid fa-trash"></i>`;
    removeBtn.onclick = async e => {
      e.stopPropagation();
      await removeFavorite(f.songId);
      row.remove();
    };

    row.appendChild(title);
    row.appendChild(removeBtn);
    box.appendChild(row);
  });

  favoriteModal.classList.remove("hidden");
}

/* ====================== SEARCH ====================== */
searchInput.oninput=async e=>await loadPlaylist(e.target.value.trim());

/* ====================== FAVORITES / HISTORY ====================== */
showFavoritesBtn.onclick=async ()=>{ 
    showFavoritesInCanvas();
};

closeFavorite.addEventListener("click", () => {
  favoriteModal.classList.add("hidden");
});

showHistoryBtn.onclick=async ()=>{
  const h=await getHistory(); historyList.innerHTML="";
  h.forEach(s=>{
    const li=document.createElement("li");
    li.textContent=`${s.name} — ${s.artist||""} (played ${s.playCount||0} times)`;
    li.onclick=()=>{
      const idx = songs.findIndex(x=>x.id===s.id);
      if(idx===-1) playDirectFromRecord(s); else playSongAtIndex(idx);
      historyModal.classList.add("hidden");
    };
    historyList.appendChild(li);
  });
  historyModal.classList.remove("hidden");
};

closeHistory.addEventListener("click", () => {
  historyModal.classList.add("hidden");
});

async function playDirectFromRecord(rec){
  if(!rec) return;
  setAudioSrc(rec.blob||rec.url);
  title.innerText = rec.name;
  artist.innerText = rec.artist||"Unknown";
  cover.src = rec.cover||"assets/cover/default.jpg";
  await updateSongInDB(rec.id,{lastPlayed:Date.now(),playCount:(rec.playCount||0)+1});
  await audio.play();
}

/* ====================== UPLOAD HANDLERS ====================== */
upload.onchange = async e => {
  const validExtensions = ["mp3", "wav", "ogg", "m4a"];

  const files = [...e.target.files].filter(f => {
    const ext = f.name.split(".").pop().toLowerCase();
    return f.type?.startsWith("audio/") || validExtensions.includes(ext);
  });

  for (const file of files) {
    await storeSong(file);
  }

  await loadPlaylist(searchInput.value);

  const firstNewSongIndex = songs.findIndex(s =>
    files.some(f => f.name.replace(/\.[^/.]+$/, "") === s.name)
  );

  if (firstNewSongIndex >= 0) {
    playSongAtIndex(firstNewSongIndex);
  }
};

chooseFolderBtn.onclick = () => folderUpload.click();

folderUpload.onchange = async (e) => {
  const allFiles = [...e.target.files];

  const validExtensions = ["mp3", "wav", "ogg", "m4a"];

  const audioFiles = allFiles.filter(f => {
    const ext = f.name.split(".").pop().toLowerCase();
    return f.type?.startsWith("audio/") || validExtensions.includes(ext);
  });

  if (audioFiles.length === 0) {
    alert("No audio files found");
    return;
  }

  let addedCount = 0;

  for (const file of audioFiles) {
    const folderName = file.webkitRelativePath?.split("/")[0] || null;

    if (isDuplicate(songs, file)) {
      console.warn("Skipped duplicate:", file.name);
      continue;
    }

    // pass the REAL file object
    await storeSong(file, folderName);
    addedCount++;
  }

  await loadPlaylist(searchInput.value);

  if (addedCount > 0) {
    const firstNewIndex = songs.length - addedCount;
    playSongAtIndex(firstNewIndex);
  }

  console.log(`${addedCount} new songs added from folder`);
};

/* ====================== CONTROL BUTTONS ====================== */
playBtn.onclick=async ()=>{ if(!audio.src)return; audio.paused?await audio.play():audio.pause(); playBtn.innerText=audio.paused?"▶":"⏸"; };
nextBtn.onclick=nextSong;
prevBtn.onclick=prevSong;
repeatBtn.onclick=()=>{ 
    repeat=!repeat; 
    loopBtn.textContent = repeat ? "loop...": "off"; 

    if (repeat) loopBtn.classList.add("active");
    else loopBtn.classList.remove("active");
}
smartShuffleBtn.onclick=()=>{ smartShuffle=!smartShuffle; smartShuffleBtn.textContent=`Smart Shuffle: ${smartShuffle?"On":"Off"}`; };
progress.oninput=()=>{ if(!isFinite(audio.duration)) return; audio.currentTime=(progress.value/100)*audio.duration; };
volume.oninput=()=>audio.volume=volume.value;
speed.oninput=()=>audio.playbackRate=speed.value;

/* ====================== VISUALIZER ====================== */
function startVisualizer() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (!analyser) {
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
    }

    // ONLY create MediaElementSource ONCE
    if (!sourceNode) {
      sourceNode = audioCtx.createMediaElementSource(audio);
      sourceNode.connect(analyser);
      analyser.connect(audioCtx.destination);
    }

    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }

    drawVisualizer();

  } catch (e) {
    console.warn("Visualizer failed:", e);
  }
}

function drawVisualizer(){
  const ctx=visualizerCanvas.getContext("2d");
  const bufferLength=analyser.fftSize;
  const dataArray=new Uint8Array(bufferLength);
  function frame(){
    analyser.getByteTimeDomainData(dataArray);
    ctx.clearRect(0,0,visualizerCanvas.width,visualizerCanvas.height);
    ctx.beginPath();
    const sliceWidth=visualizerCanvas.width/bufferLength;
    let x=0;
    for(let i=0;i<bufferLength;i++){
      const v=dataArray[i]/128.0;
      const y=v*visualizerCanvas.height/2;
      i===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
      x+=sliceWidth;
    }
    ctx.lineWidth=2; ctx.stroke();
    vizAnimationId=requestAnimationFrame(frame);
  }
  if(vizAnimationId) cancelAnimationFrame(vizAnimationId);
  frame();
}

/* ====================== LYRICS ====================== */
function parseLRC(lrcText){
  const lines=lrcText.split(/\r?\n/);
  const out=[];
  const timeRegex=/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;
  for(const raw of lines){
    let line=raw.trim(); if(!line) continue;
    let m,timestamps=[];
    while((m=timeRegex.exec(line))!==null){
      const min=parseInt(m[1],10), sec=parseInt(m[2],10);
      const ms=m[3]?parseInt(m[3].padEnd(3,"0"),10):0;
      timestamps.push(min*60+sec+ms/1000);
    }
    const txt=line.replace(/\[.*?\]/g,"").trim();
    timestamps.forEach(t=>out.push({time:t,text:txt}));
  }
  return out.sort((a,b)=>a.time-b.time);
}
function parseAndDisplayLyrics(lrcText){
  lyricLines=parseLRC(lrcText);
  lyricsDisplay.innerHTML=lyricLines.map(l=>`<div data-time="${l.time}">${escapeHtml(l.text)}</div>`).join("");
  startLyricSync();
}
function startLyricSync(){
  if(lyricTimer) clearInterval(lyricTimer);
  lyricTimer=setInterval(()=>{
    if(!audio||!lyricLines.length) return;
    const t=audio.currentTime;
    let idx=-1;
    for(let i=0;i<lyricLines.length;i++) if(t>=lyricLines[i].time) idx=i; else break;
    const nodes=lyricsDisplay.querySelectorAll("div");
    nodes.forEach(n=>n.style.opacity="0.4");
    if(idx>=0&&nodes[idx]){ nodes[idx].style.opacity="1"; nodes[idx].scrollIntoView({behavior:"smooth",block:"center"}); }
  },300);
}
function clearLyricsDisplay(){ lyricLines=[]; lyricsDisplay.innerText=""; if(lyricTimer) clearInterval(lyricTimer); }

/* ====================== AUDIO EVENTS ====================== */
audio.ontimeupdate=()=>{ if(!isFinite(audio.duration)) return; progress.value=(audio.currentTime/audio.duration)*100||0; current.innerText=format(audio.currentTime); duration.innerText=format(audio.duration); };
audio.onended=()=>repeat?audio.play():nextSong();

/* ====================== START ====================== */
window.onload=async()=>{ await loadPlaylist(); };

window.resetSongsDB = async function () {
  const all = await getAllSongsFromDB();

  if (!all || all.length === 0) {
    console.warn("DB already empty.");
    return;
  }

  for (const s of all) {
    if (s?.id) {
      await deleteSongFromDB(s.id);
      console.warn("Deleted:", s.name || s.id);
    }
  }

  console.warn("All songs removed. Database reset completed.");
}

window.songs = songs;