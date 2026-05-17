// ============================================================
// Mappa Ristoranti — logica principale
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getFirestore, collection, getDocs, addDoc, deleteDoc, doc, updateDoc,
  serverTimestamp, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { firebaseConfig, GOOGLE_MAPS_API_KEY, MAP_DEFAULT_CENTER, MAP_DEFAULT_ZOOM } from "./config.js";

// --- Firebase init -------------------------------------------------
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const RESTAURANTS = collection(db, "restaurants");

// --- State ---------------------------------------------------------
const state = {
  restaurants: [],         // tutti i ristoranti caricati da Firestore
  filteredTags: new Set(), // tag attivi nei filtri
  searchText: "",          // testo nel filtro di ricerca
  sortBy: localStorage.getItem("sortBy") || "recent", // "recent" | "oldest" | "name"
  map: null,
  markers: [],
  markerClusterer: null,
  MarkerClustererClass: null,
  placesService: null,
  autocompleteService: null,
  pendingPlace: null,      // place selezionato pronto da salvare
  infoWindow: null,
  currentDetailRestaurant: null, // ristorante aperto nel modal
};

// --- DOM refs ------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const listContainer = $("#restaurant-list");
const listSearch = $("#list-search");
const sortByEl = $("#sort-by");
const tagFiltersEl = $("#tag-filters");
const counterEl = $("#list-counter");
const placesSearchInput = $("#places-search");
const placesResultsEl = $("#places-results");
const placesStatusEl = $("#places-status");
const mapSearchInput = $("#map-search");
const mapSearchResultsEl = $("#map-search-results");
const confirmPanel = $("#confirm-panel");
const confirmSummary = $("#confirm-summary");
const confirmTagsInput = $("#confirm-tags");
const confirmNoteInput = $("#confirm-note");
const detailModal = $("#detail-modal");
const modalContent = $("#modal-content");

// --- Utility -------------------------------------------------------
function toast(msg, ms = 2200) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), ms);
}

function mapsLinkFor(r) {
  // Preferisci place_id se presente, altrimenti coordinate, altrimenti nome+indirizzo
  if (r.placeId) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.name)}&query_place_id=${r.placeId}`;
  }
  if (r.lat != null && r.lng != null) {
    return `https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}`;
  }
  const q = encodeURIComponent(`${r.name} ${r.address || ""}`.trim());
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}

function navLinkFor(r) {
  // Link diretto alla navigazione (apre Google Maps con direzioni)
  if (r.lat != null && r.lng != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}${r.placeId ? `&destination_place_id=${r.placeId}` : ""}`;
  }
  const q = encodeURIComponent(`${r.name} ${r.address || ""}`.trim());
  return `https://www.google.com/maps/dir/?api=1&destination=${q}`;
}

function iconEmoji(icon) {
  const map = {
    icecream: "🍨",
    restaurant: "🍽️",
    pizza: "🍕",
    cafe: "☕",
    coffee: "☕",
    burger: "🍔",
    sushi: "🍣",
    bar: "🍷",
  };
  return map[icon] || "🍽️";
}

function uniqueTagsFrom(restaurants) {
  const map = new Map();
  for (const r of restaurants) {
    for (const t of (r.tags || [])) {
      if (!map.has(t.name)) map.set(t.name, t.color || "#64803f");
    }
  }
  return [...map.entries()].map(([name, color]) => ({ name, color }));
}

// --- Firestore ops -------------------------------------------------
async function loadRestaurants() {
  try {
    const snap = await getDocs(RESTAURANTS);
    state.restaurants = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    sortRestaurants();
    counterEl.textContent = `${state.restaurants.length} ristoranti`;
    renderTagFilters();
    renderList();
    renderMapMarkers();
  } catch (e) {
    console.error(e);
    counterEl.textContent = "Errore di caricamento — controlla la configurazione Firebase.";
  }
}

function getCreatedAtMs(r) {
  // Supporta Timestamp Firestore (con .toMillis()) e Date / oggetto seriale
  if (!r.createdAt) return 0;
  if (typeof r.createdAt.toMillis === "function") return r.createdAt.toMillis();
  if (r.createdAt.seconds != null) return r.createdAt.seconds * 1000;
  const t = new Date(r.createdAt).getTime();
  return isNaN(t) ? 0 : t;
}

function sortRestaurants() {
  const mode = state.sortBy;
  state.restaurants.sort((a, b) => {
    if (mode === "name") return a.name.localeCompare(b.name, "it");
    const tA = getCreatedAtMs(a);
    const tB = getCreatedAtMs(b);
    return mode === "oldest" ? tA - tB : tB - tA;
  });
}

async function saveRestaurant(data) {
  const docRef = await addDoc(RESTAURANTS, {
    ...data,
    createdAt: serverTimestamp()
  });
  return docRef.id;
}

async function removeRestaurant(id) {
  await deleteDoc(doc(db, "restaurants", id));
}

async function updateRestaurant(id, fields) {
  await updateDoc(doc(db, "restaurants", id), fields);
}

// --- Render: list --------------------------------------------------
function renderTagFilters() {
  const tags = uniqueTagsFrom(state.restaurants);
  tags.sort((a, b) => a.name.localeCompare(b.name, "it"));
  tagFiltersEl.innerHTML = "";
  for (const t of tags) {
    const el = document.createElement("div");
    el.className = "tag-filter" + (state.filteredTags.has(t.name) ? " active" : "");
    el.textContent = t.name;
    el.style.borderColor = t.color;
    if (state.filteredTags.has(t.name)) {
      el.style.background = t.color;
      el.style.color = "#fff";
    }
    el.onclick = () => {
      if (state.filteredTags.has(t.name)) state.filteredTags.delete(t.name);
      else state.filteredTags.add(t.name);
      renderTagFilters();
      renderList();
    };
    tagFiltersEl.appendChild(el);
  }
}

function applyFilters(list) {
  const q = state.searchText.trim().toLowerCase();
  return list.filter(r => {
    if (state.filteredTags.size > 0) {
      const tagNames = new Set((r.tags || []).map(t => t.name));
      for (const t of state.filteredTags) if (!tagNames.has(t)) return false;
    }
    if (!q) return true;
    const hay = `${r.name} ${r.address || ""} ${(r.tags || []).map(t => t.name).join(" ")}`.toLowerCase();
    return hay.includes(q);
  });
}

function renderList() {
  const filtered = applyFilters(state.restaurants);
  counterEl.textContent = `${filtered.length} su ${state.restaurants.length} ristoranti`;
  listContainer.innerHTML = "";
  if (filtered.length === 0) {
    listContainer.innerHTML = `<div style="padding:30px;color:#888;text-align:center;grid-column:1/-1">Nessun ristorante trovato.</div>`;
    return;
  }
  for (const r of filtered) {
    const card = document.createElement("div");
    card.className = "card";
    const tagsHtml = (r.tags || []).map(t => `<span class="tag-pill" style="background:${t.color || '#64803f'}">${escapeHtml(t.name)}</span>`).join("");
    const ratingHtml = r.rating
      ? `<div class="card-rating">⭐ ${Number(r.rating).toFixed(1)}${r.userRatingsTotal ? ` <span class="rating-count">(${r.userRatingsTotal})</span>` : ""}</div>`
      : "";
    card.innerHTML = `
      <div class="card-head">
        <span class="card-icon">${iconEmoji(r.icon)}</span>
        <div class="card-name">${escapeHtml(r.name)}</div>
      </div>
      <div class="card-address">${escapeHtml(r.address || "")}</div>
      ${ratingHtml}
      <div class="card-tags">${tagsHtml}</div>
      <div class="card-actions">
        <a class="maps-link" href="${mapsLinkFor(r)}" target="_blank" rel="noopener">📍 Apri in Maps</a>
        <button data-id="${r.id}" class="btn-detail">Dettagli</button>
      </div>
    `;
    card.querySelector(".btn-detail").onclick = (e) => { e.stopPropagation(); openDetail(r); };
    card.onclick = () => openDetail(r);
    listContainer.appendChild(card);
  }
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function openDetail(r) {
  state.currentDetailRestaurant = r;
  renderDetailView(r);
  detailModal.classList.remove("hidden");
}

function renderDetailView(r) {
  const tagsHtml = (r.tags || []).map(t => `<span class="tag-pill" style="background:${t.color || '#64803f'}">${escapeHtml(t.name)}</span>`).join("");
  const ratingHtml = r.rating
    ? `<div class="detail-rating">⭐ <strong>${Number(r.rating).toFixed(1)}</strong>${r.userRatingsTotal ? ` <span class="rating-count">(${r.userRatingsTotal} recensioni)</span>` : ""}</div>`
    : `<button id="refresh-google" class="link-btn">🔄 Recupera info da Google Maps</button>`;
  modalContent.innerHTML = `
    <div class="detail-header">
      <h2>${iconEmoji(r.icon)} ${escapeHtml(r.name)}</h2>
      <button id="edit-btn" class="icon-btn" title="Modifica">✏️</button>
    </div>
    <p class="detail-addr">${escapeHtml(r.address || "")}</p>
    ${ratingHtml}
    <div class="card-tags" style="margin:10px 0 14px 0;">${tagsHtml}</div>
    ${r.note ? `<div class="detail-note">📝 ${escapeHtml(r.note)}</div>` : `<div class="detail-note-empty">Nessuna nota personale. Clicca ✏️ per aggiungerla.</div>`}
    <div class="detail-actions">
      <a href="${mapsLinkFor(r)}" target="_blank" rel="noopener" class="btn-primary">📍 Apri in Maps</a>
      <a href="${navLinkFor(r)}" target="_blank" rel="noopener" class="btn-primary btn-dark">🧭 Navigazione</a>
    </div>
    <button id="modal-delete" class="btn-danger">🗑️ Rimuovi dall'elenco</button>
  `;
  document.getElementById("edit-btn").onclick = () => renderEditView(r);
  document.getElementById("modal-delete").onclick = async () => {
    if (!confirm(`Rimuovere "${r.name}" dall'elenco?`)) return;
    await removeRestaurant(r.id);
    detailModal.classList.add("hidden");
    toast("Ristorante rimosso");
    await loadRestaurants();
  };
  const refreshBtn = document.getElementById("refresh-google");
  if (refreshBtn) {
    refreshBtn.onclick = () => refreshGoogleInfo(r);
  }
}

function renderEditView(r) {
  const tagsString = (r.tags || []).map(t => t.name).join(", ");
  modalContent.innerHTML = `
    <h2 style="margin:0 0 12px 0;">✏️ Modifica</h2>
    <p class="detail-addr" style="margin-bottom:14px;">${escapeHtml(r.name)}</p>
    <label class="field-label">Tag (separati da virgola)</label>
    <input type="text" id="edit-tags" value="${escapeHtml(tagsString)}" placeholder="Vegan, Pizza, Per provare" />
    <label class="field-label">Nota personale</label>
    <textarea id="edit-note" rows="3" placeholder="Es. Pizza al tartufo eccellente!">${escapeHtml(r.note || "")}</textarea>
    <div class="btn-row" style="margin-top:14px;">
      <button id="save-edit" class="btn-primary">💾 Salva modifiche</button>
      <button id="cancel-edit">Annulla</button>
    </div>
  `;
  const tagPalette = ["#64803f", "#753f80", "#803f54", "#6edf38", "#3f806b", "#32d90d", "#3f805f", "#80683f"];
  document.getElementById("save-edit").onclick = async () => {
    const newTagsText = document.getElementById("edit-tags").value;
    const newNote = document.getElementById("edit-note").value.trim();
    // Preserva il colore esistente per tag con lo stesso nome
    const existingColorByName = Object.fromEntries((r.tags || []).map(t => [t.name, t.color]));
    const newTags = newTagsText.split(",").map(s => s.trim()).filter(Boolean).map((name, i) => ({
      name,
      color: existingColorByName[name] || tagPalette[i % tagPalette.length]
    }));
    try {
      await updateRestaurant(r.id, { tags: newTags, note: newNote });
      toast("Modifiche salvate");
      await loadRestaurants();
      // Aggiorna lo stato del modal corrente
      const updated = state.restaurants.find(x => x.id === r.id);
      if (updated) {
        state.currentDetailRestaurant = updated;
        renderDetailView(updated);
      } else {
        detailModal.classList.add("hidden");
      }
    } catch (e) {
      console.error(e);
      toast("Errore di salvataggio: " + e.message);
    }
  };
  document.getElementById("cancel-edit").onclick = () => renderDetailView(r);
}

async function refreshGoogleInfo(r) {
  if (!state.placesService) {
    toast("Mappa non ancora pronta, riprova fra un attimo.");
    return;
  }
  const findFields = ["place_id", "name", "formatted_address", "geometry", "rating", "user_ratings_total"];
  const onResult = async (place) => {
    const loc = place.geometry?.location;
    const updates = {
      placeId: place.place_id,
      rating: place.rating ?? null,
      userRatingsTotal: place.user_ratings_total ?? null,
    };
    if (loc && (r.lat == null || r.lng == null)) {
      updates.lat = loc.lat();
      updates.lng = loc.lng();
    }
    try {
      await updateRestaurant(r.id, updates);
      toast("Info Google aggiornate");
      await loadRestaurants();
      const updated = state.restaurants.find(x => x.id === r.id);
      if (updated) {
        state.currentDetailRestaurant = updated;
        renderDetailView(updated);
      }
    } catch (e) {
      console.error(e);
      toast("Errore: " + e.message);
    }
  };
  if (r.placeId) {
    state.placesService.getDetails({ placeId: r.placeId, fields: findFields }, (place, status) => {
      if (status !== google.maps.places.PlacesServiceStatus.OK || !place) {
        toast("Nessun risultato da Google Maps.");
        return;
      }
      onResult(place);
    });
  } else {
    // Cerca per nome+indirizzo
    const queryText = `${r.name} ${r.address || ""}`.trim();
    state.placesService.findPlaceFromQuery(
      { query: queryText, fields: findFields },
      (results, status) => {
        if (status !== google.maps.places.PlacesServiceStatus.OK || !results || results.length === 0) {
          toast("Nessun risultato su Google Maps.");
          return;
        }
        onResult(results[0]);
      }
    );
  }
}

// --- Render: map ---------------------------------------------------
async function initMap() {
  state.map = new google.maps.Map(document.getElementById("map"), {
    center: MAP_DEFAULT_CENTER,
    zoom: MAP_DEFAULT_ZOOM,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
    gestureHandling: "greedy", // permette pan/zoom con una dita su mobile
    clickableIcons: false,     // evita interferenze con click sui POI di Google
  });
  state.infoWindow = new google.maps.InfoWindow();
  // Places services for Add view
  state.placesService = new google.maps.places.PlacesService(state.map);
  state.autocompleteService = new google.maps.places.AutocompleteService();

  // Carica MarkerClusterer da CDN (non blocca: appena pronta, riapplica i marker)
  loadClusterer().then(() => {
    if (state.markers.length > 0) renderMapMarkers();
  }).catch(err => console.warn("Clusterer non caricabile:", err));

  renderMapMarkers();
}

async function loadClusterer() {
  if (state.MarkerClustererClass) return state.MarkerClustererClass;
  const mod = await import("https://cdn.jsdelivr.net/npm/@googlemaps/markerclusterer@2.5.3/+esm");
  state.MarkerClustererClass = mod.MarkerClusterer;
  return state.MarkerClustererClass;
}

function clearMarkers() {
  if (state.markerClusterer) {
    state.markerClusterer.clearMarkers();
    state.markerClusterer = null;
  }
  state.markers.forEach(m => m.setMap(null));
  state.markers = [];
}

// Pin SVG ad alta visibilità: goccia verde con bordo bianco, ombra e dot interno.
// Disegnato grande (size 44x56) così resta nitido e ben distinguibile dalle icone POI di Google.
let _pinIconCache = null;
function buildPinIcon() {
  if (_pinIconCache) return _pinIconCache;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="56" viewBox="0 0 44 56">
    <defs>
      <filter id="ds" x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx="0" dy="2" stdDeviation="1.8" flood-color="#000" flood-opacity="0.4"/>
      </filter>
      <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#7a9a4d"/>
        <stop offset="1" stop-color="#4a6328"/>
      </linearGradient>
    </defs>
    <path filter="url(#ds)" fill="url(#g)" stroke="#ffffff" stroke-width="3"
      d="M22 3 C11.5 3 3 11.3 3 21.6 c0 14.2 19 31.4 19 31.4 s19 -17.2 19 -31.4 C41 11.3 32.5 3 22 3 z"/>
    <circle cx="22" cy="21" r="7.5" fill="#ffffff"/>
    <circle cx="22" cy="21" r="3.5" fill="#4a6328"/>
  </svg>`;
  const url = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
  _pinIconCache = {
    url,
    scaledSize: new google.maps.Size(44, 56),
    size: new google.maps.Size(44, 56),
    anchor: new google.maps.Point(22, 54),
    labelOrigin: new google.maps.Point(22, 21),
  };
  return _pinIconCache;
}

function renderMapMarkers() {
  if (!state.map) return;
  clearMarkers();
  const bounds = new google.maps.LatLngBounds();
  const markers = [];
  let count = 0;
  for (const r of state.restaurants) {
    if (r.lat == null || r.lng == null) continue;
    const marker = new google.maps.Marker({
      position: { lat: r.lat, lng: r.lng },
      title: r.name,
      icon: buildPinIcon(),
      zIndex: 1000,
      optimized: false,
    });
    marker.addListener("click", () => {
      const ratingLine = r.rating ? `<div class="iw-rating">⭐ ${Number(r.rating).toFixed(1)}${r.userRatingsTotal ? ` (${r.userRatingsTotal})` : ""}</div>` : "";
      const html = `
        <div class="info-window">
          <h4>${iconEmoji(r.icon)} ${escapeHtml(r.name)}</h4>
          <div class="iw-addr">${escapeHtml(r.address || "")}</div>
          ${ratingLine}
          <div class="iw-tags">
            ${(r.tags || []).slice(0, 5).map(t => `<span class="tag-pill" style="background:${t.color || '#64803f'}">${escapeHtml(t.name)}</span>`).join("")}
          </div>
          <a href="${mapsLinkFor(r)}" target="_blank" rel="noopener">📍 Apri in Maps</a>
        </div>`;
      state.infoWindow.setContent(html);
      state.infoWindow.open(state.map, marker);
    });
    markers.push(marker);
    bounds.extend({ lat: r.lat, lng: r.lng });
    count++;
  }
  state.markers = markers;
  // Se MarkerClusterer è disponibile, usalo (raggruppa marker e riduce drasticamente il lag su mobile)
  if (state.MarkerClustererClass) {
    state.markerClusterer = new state.MarkerClustererClass({ map: state.map, markers });
  } else {
    markers.forEach(m => m.setMap(state.map));
  }
  if (count > 0 && !state.mapHasBeenFit) {
    state.map.fitBounds(bounds, 40);
    state.mapHasBeenFit = true;
  }
}

// --- Add view: search & confirm ------------------------------------
function performPlacesSearch() {
  const text = placesSearchInput.value.trim();
  if (!text) {
    placesResultsEl.innerHTML = "";
    placesStatusEl.classList.add("hidden");
    return;
  }
  if (!state.autocompleteService) {
    placesStatusEl.textContent = "Mappa non ancora pronta, riprova fra un attimo…";
    placesStatusEl.classList.remove("hidden");
    return;
  }
  placesStatusEl.textContent = "Ricerca in corso…";
  placesStatusEl.classList.remove("hidden");
  state.autocompleteService.getPlacePredictions(
    { input: text, types: ["establishment"] },
    (preds, status) => {
      // Se il testo è cambiato nel frattempo, ignora questa risposta
      if (placesSearchInput.value.trim() !== text) return;
      if (status !== google.maps.places.PlacesServiceStatus.OK || !preds || preds.length === 0) {
        placesResultsEl.innerHTML = "";
        placesStatusEl.textContent = "Nessun risultato.";
        placesStatusEl.classList.remove("hidden");
        return;
      }
      placesStatusEl.classList.add("hidden");
      placesResultsEl.innerHTML = "";
      for (const p of preds) {
        const div = document.createElement("div");
        div.className = "place-result";
        div.innerHTML = `
          <div class="pr-name">${escapeHtml(p.structured_formatting.main_text)}</div>
          <div class="pr-addr">${escapeHtml(p.structured_formatting.secondary_text || "")}</div>
        `;
        div.onclick = () => loadPlaceDetails(p.place_id);
        placesResultsEl.appendChild(div);
      }
    }
  );
}

// debounce util
function debounce(fn, ms) {
  let t = null;
  return function(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

// --- Map view: city search ----------------------------------------
function performMapSearch() {
  const text = mapSearchInput.value.trim();
  if (!text) {
    mapSearchResultsEl.innerHTML = "";
    mapSearchResultsEl.classList.add("hidden");
    return;
  }
  if (!state.autocompleteService) return;
  state.autocompleteService.getPlacePredictions(
    { input: text, types: ["(cities)"] },
    (preds, status) => {
      if (mapSearchInput.value.trim() !== text) return;
      if (status !== google.maps.places.PlacesServiceStatus.OK || !preds || preds.length === 0) {
        mapSearchResultsEl.innerHTML = `<div class="map-search-empty">Nessuna città trovata</div>`;
        mapSearchResultsEl.classList.remove("hidden");
        return;
      }
      mapSearchResultsEl.innerHTML = "";
      for (const p of preds) {
        const div = document.createElement("div");
        div.className = "map-search-result";
        div.innerHTML = `
          <div class="ms-name">📍 ${escapeHtml(p.structured_formatting.main_text)}</div>
          <div class="ms-addr">${escapeHtml(p.structured_formatting.secondary_text || "")}</div>
        `;
        div.onclick = () => zoomToCity(p.place_id, p.structured_formatting.main_text);
        mapSearchResultsEl.appendChild(div);
      }
      mapSearchResultsEl.classList.remove("hidden");
    }
  );
}

function zoomToCity(placeId, cityName) {
  if (!state.placesService) return;
  state.placesService.getDetails(
    { placeId, fields: ["geometry", "name"] },
    (place, status) => {
      if (status !== google.maps.places.PlacesServiceStatus.OK || !place?.geometry) {
        toast("Impossibile zoomare sulla città.");
        return;
      }
      if (place.geometry.viewport) {
        state.map.fitBounds(place.geometry.viewport, 0);
      } else if (place.geometry.location) {
        state.map.setCenter(place.geometry.location);
        state.map.setZoom(13);
      }
      mapSearchInput.value = cityName || place.name || "";
      mapSearchResultsEl.classList.add("hidden");
    }
  );
}

function loadPlaceDetails(placeId) {
  state.placesService.getDetails(
    {
      placeId,
      fields: ["place_id", "name", "formatted_address", "geometry", "rating", "user_ratings_total", "types", "url"]
    },
    (place, status) => {
      if (status !== google.maps.places.PlacesServiceStatus.OK) {
        toast("Errore caricamento dettagli.");
        return;
      }
      state.pendingPlace = place;
      const loc = place.geometry?.location;
      const lat = loc ? loc.lat() : null;
      const lng = loc ? loc.lng() : null;
      confirmSummary.innerHTML = `
        <strong>${escapeHtml(place.name)}</strong><br>
        ${escapeHtml(place.formatted_address || "")}<br>
        ${place.rating ? `⭐ ${place.rating} (${place.user_ratings_total || 0} recensioni)<br>` : ""}
        <span style="color:#888;font-size:12px;">📍 ${lat?.toFixed(5)}, ${lng?.toFixed(5)}</span>
      `;
      confirmTagsInput.value = "Vegan";
      confirmNoteInput.value = "";
      confirmPanel.classList.remove("hidden");
      confirmPanel.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  );
}

async function saveConfirmedPlace() {
  if (!state.pendingPlace) return;
  const p = state.pendingPlace;
  const loc = p.geometry?.location;
  const tagPalette = ["#64803f", "#753f80", "#803f54", "#6edf38", "#3f806b", "#32d90d", "#3f805f", "#80683f"];
  const tags = confirmTagsInput.value
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .map((name, i) => ({ name, color: tagPalette[i % tagPalette.length] }));
  // Heuristic icon
  const types = p.types || [];
  let icon = "restaurant";
  if (types.includes("cafe")) icon = "cafe";
  else if (types.includes("bar")) icon = "bar";
  else if (types.some(t => /ice_cream/.test(t))) icon = "icecream";

  const data = {
    name: p.name,
    address: p.formatted_address || "",
    lat: loc ? loc.lat() : null,
    lng: loc ? loc.lng() : null,
    placeId: p.place_id,
    icon,
    tags,
    note: confirmNoteInput.value.trim(),
    rating: p.rating ?? null,
    userRatingsTotal: p.user_ratings_total ?? null,
    source: "google-places"
  };
  try {
    await saveRestaurant(data);
    toast(`✅ "${p.name}" salvato!`);
    confirmPanel.classList.add("hidden");
    state.pendingPlace = null;
    placesSearchInput.value = "";
    placesResultsEl.innerHTML = "";
    await loadRestaurants();
    // torna alla lista
    switchView("list");
  } catch (e) {
    console.error(e);
    toast("Errore di salvataggio: " + e.message);
  }
}

// --- View switching ------------------------------------------------
function switchView(name) {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.view === name));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id === `view-${name}`));
  if (name === "map" && state.map) {
    // forza ridisegno dopo show
    setTimeout(() => google.maps.event.trigger(state.map, "resize"), 50);
  }
}

// --- Wire up events ------------------------------------------------
document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => switchView(t.dataset.view)));
listSearch.addEventListener("input", (e) => { state.searchText = e.target.value; renderList(); });

// Toggle espandi/comprimi tag filtri in cima
const tagFiltersToggleBtn = document.getElementById("tag-filters-toggle");
if (tagFiltersToggleBtn) {
  tagFiltersToggleBtn.addEventListener("click", () => {
    const collapsed = tagFiltersEl.classList.toggle("collapsed");
    tagFiltersToggleBtn.textContent = collapsed ? "▾" : "▴";
    tagFiltersToggleBtn.setAttribute("aria-label", collapsed ? "Espandi tag" : "Comprimi tag");
  });
}
// Sync sort dropdown col valore in stato (caricato da localStorage)
if (sortByEl) {
  sortByEl.value = state.sortBy;
  sortByEl.addEventListener("change", (e) => {
    state.sortBy = e.target.value;
    localStorage.setItem("sortBy", state.sortBy);
    sortRestaurants();
    renderList();
  });
}
// Auto-search mentre l'utente scrive (debounce 300ms)
const debouncedPlacesSearch = debounce(performPlacesSearch, 300);
placesSearchInput.addEventListener("input", debouncedPlacesSearch);

// Ricerca città nella mappa (debounce 250ms)
const debouncedMapSearch = debounce(performMapSearch, 250);
mapSearchInput?.addEventListener("input", debouncedMapSearch);
mapSearchInput?.addEventListener("focus", () => {
  if (mapSearchResultsEl.children.length > 0) mapSearchResultsEl.classList.remove("hidden");
});
// Click fuori dal box ricerca mappa → chiudi i risultati
document.addEventListener("click", (e) => {
  if (!e.target.closest(".map-search-overlay")) {
    mapSearchResultsEl?.classList.add("hidden");
  }
});
$("#confirm-save").addEventListener("click", saveConfirmedPlace);
$("#confirm-cancel").addEventListener("click", () => { confirmPanel.classList.add("hidden"); state.pendingPlace = null; });
$("#modal-close").addEventListener("click", () => detailModal.classList.add("hidden"));
detailModal.addEventListener("click", (e) => { if (e.target === detailModal) detailModal.classList.add("hidden"); });

// --- Boot ----------------------------------------------------------
window.__onGoogleMapsReady = () => {
  initMap();
};

if (!GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY.includes("INCOLLA")) {
  counterEl.textContent = "⚠️ Configura GOOGLE_MAPS_API_KEY in config.js";
} else {
  window.__loadGoogleMaps(GOOGLE_MAPS_API_KEY);
}

loadRestaurants();
