let db;

const DB_NAME = "MusicPlayerDB_Stable";
const SONGS = "songs";
const FAVORITES = "favorites";
const VERSION = 7; // bump for schema

/* ----------------------------------------
   UUID generator — STABLE forever
---------------------------------------- */
function uuid() {
  return crypto.randomUUID();
}

/* ----------------------------------------
   Open DB
---------------------------------------- */
export function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);

    req.onupgradeneeded = () => {
      db = req.result;

      // Songs: stable key manually assigned (string UUID)
      if (!db.objectStoreNames.contains(SONGS)) {
        const s = db.createObjectStore(SONGS, { keyPath: "id" });
        s.createIndex("name", "name");
        s.createIndex("lastPlayed", "lastPlayed");
        s.createIndex("playCount", "playCount");
      }

      // Favorites: key is the original songId
      if (!db.objectStoreNames.contains(FAVORITES)) {
        const f = db.createObjectStore(FAVORITES, { keyPath: "songId" });
        f.createIndex("addedAt", "addedAt");
      }
    };

    req.onsuccess = () => {
      db = req.result;
      resolve(db);
    };

    req.onerror = () => reject(req.error);
  });
}

/* ----------------------------------------
   SONGS
---------------------------------------- */

// Add song with STABLE ID
export async function addSongToDB(songData) {
  await openDB();

  const stableId = songData.id || uuid(); 

  const payload = {
    id: stableId,
    name: songData.name || "Untitled",
    artist: songData.artist || "Unknown",
    blob: songData.blob || null,
    url: songData.url || null,
    cover: songData.cover || null,
    playCount: songData.playCount || 0,
    lastPlayed: songData.lastPlayed || null,
    lyrics: songData.lyrics || null,
    folder: songData.folder || null
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(SONGS, "readwrite");
    const store = tx.objectStore(SONGS);
    const putReq = store.put(payload);
    putReq.onsuccess = () => resolve(stableId);
    putReq.onerror = () => reject(putReq.error);
  });
}

export async function getAllSongsFromDB() {
  await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SONGS, "readonly");
    const store = tx.objectStore(SONGS);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteSongFromDB(id) {
  await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SONGS, "readwrite");
    const req = tx.objectStore(SONGS).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function updateSongInDB(id, updates) {
  await openDB();
  const tx = db.transaction(SONGS, "readwrite");
  const store = tx.objectStore(SONGS);

  return new Promise((resolve, reject) => {
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const rec = getReq.result;
      if (!rec) return reject(new Error("Not found"));
      Object.assign(rec, updates);
      store.put(rec).onsuccess = () => resolve(rec);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/* ----------------------------------------
   FAVORITES — full snapshot clone
---------------------------------------- */

export async function addFavorite(song) {
  await openDB();

  if (!song || !song.id) throw new Error("addFavorite requires full song object with stable id");

  const clone = {
    songId: song.id,
    name: song.name,
    artist: song.artist,
    blob: song.blob || null,
    url: song.url || null,
    cover: song.cover || null,
    lyrics: song.lyrics || null,
    folder: song.folder || null,
    addedAt: Date.now()
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(FAVORITES, "readwrite");
    const store = tx.objectStore(FAVORITES);
    const req = store.put(clone);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function removeFavorite(songId) {
  await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FAVORITES, "readwrite");
    const req = tx.objectStore(FAVORITES).delete(songId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getFavorites() {
  await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FAVORITES, "readonly");
    const req = tx.objectStore(FAVORITES).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/* ----------------------------------------
   HISTORY
---------------------------------------- */
export async function getHistory() {
  const all = await getAllSongsFromDB();
  return all.filter(s => s.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed);
}

/* ----------------------------------------
   RESET
---------------------------------------- */
export async function resetSongsDB() {
  await openDB();
  db.transaction(SONGS, "readwrite").objectStore(SONGS).clear();
  db.transaction(FAVORITES, "readwrite").objectStore(FAVORITES).clear();
}