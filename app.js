// ============================================================
// Mappa Ristoranti — logica principale
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getFirestore, collection, getDocs, addDoc, deleteDoc, doc,
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
  map: null,
  markers: [],
  placesService: null,
  autocompleteService: null,
  pendingPlace: null,      // place selezionato pronto da salvare
  infoWindow: null,
};

// --- DOM refs ------------------------------------------------------
const $ = (sel) => document.querySelector(sel);
const listContainer = $("#restaurant-list");
const listSearch = $("#list-search");
const tagFiltersEl = $("#tag-filters");
const counterEl = $("#list-counter");
const placesSearchInput = $("#places-search");
const placesResultsEl = $("#places-results");
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
    const snap = await getDocs(query(RESTAURANTS, orderBy("name")));
    state.restaurants = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    counterEl.textContent = `${state.restaurants.length} ristoranti`;
    renderTagFilters();
    renderList();
    renderMapMarkers();
  } catch (e) {
    console.error(e);
    counterEl.textContent = "Errore di caricamento — controlla la configurazione Firebase.";
  }
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
    card.innerHTML = `
      <div class="card-head">
        <span class="card-icon">${iconEmoji(r.icon)}</span>
        <div class="card-name">${escapeHtml(r.name)}</div>
      </div>
      <div class="card-address">${escapeHtml(r.address || "")}</div>
      <div class="card-tags">
        ${(r.tags || []).map(t => `<span class="tag-pill" style="background:${t.color || '#64803f'}">${escapeHtml(t.name)}</span>`).join("")}
      </div>
      <div class="card-actions">
        <a class="maps-link" href="${navLinkFor(r)}" target="_blank" rel="noopener">🧭 Indicazioni</a>
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
  modalContent.innerHTML = `
    <h2 style="margin:0 0 4px 0;">${iconEmoji(r.icon)} ${escapeHtml(r.name)}</h2>
    <p style="color:#666;font-size:14px;margin:0 0 14px 0;">${escapeHtml(r.address || "")}</p>
    <div class="card-tags" style="margin-bottom:14px;">
      ${(r.tags || []).map(t => `<span class="tag-pill" style="background:${t.color || '#64803f'}">${escapeHtml(t.name)}</span>`).join("")}
    </div>
    ${r.note ? `<p style="background:#f7f5f0;padding:10px;border-radius:8px;font-size:14px;">📝 ${escapeHtml(r.note)}</p>` : ""}
    <div style="display:flex;gap:8px;margin-top:18px;flex-wrap:wrap;">
      <a href="${mapsLinkFor(r)}" target="_blank" rel="noopener" style="flex:1;text-align:center;background:#64803f;color:#fff;padding:10px;border-radius:8px;text-decoration:none;font-weight:600;">📍 Apri in Maps</a>
      <a href="${navLinkFor(r)}" target="_blank" rel="noopener" style="flex:1;text-align:center;background:#4a6328;color:#fff;padding:10px;border-radius:8px;text-decoration:none;font-weight:600;">🧭 Navigazione</a>
    </div>
    <button id="modal-delete" style="margin-top:14px;width:100%;padding:10px;background:#fff;color:#b33;border:1px solid #fcc;border-radius:8px;cursor:pointer;font-weight:500;">🗑️ Rimuovi dall'elenco</button>
  `;
  document.getElementById("modal-delete").onclick = async () => {
    if (!confirm(`Rimuovere "${r.name}" dall'elenco?`)) return;
    await removeRestaurant(r.id);
    detailModal.classList.add("hidden");
    toast("Ristorante rimosso");
    await loadRestaurants();
  };
  detailModal.classList.remove("hidden");
}

// --- Render: map ---------------------------------------------------
function initMap() {
  state.map = new google.maps.Map(document.getElementById("map"), {
    center: MAP_DEFAULT_CENTER,
    zoom: MAP_DEFAULT_ZOOM,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
  });
  state.infoWindow = new google.maps.InfoWindow();
  // Places services for Add view
  state.placesService = new google.maps.places.PlacesService(state.map);
  state.autocompleteService = new google.maps.places.AutocompleteService();
  renderMapMarkers();
}

function clearMarkers() {
  state.markers.forEach(m => m.setMap(null));
  state.markers = [];
}

function renderMapMarkers() {
  if (!state.map) return;
  clearMarkers();
  const bounds = new google.maps.LatLngBounds();
  let count = 0;
  for (const r of state.restaurants) {
    if (r.lat == null || r.lng == null) continue;
    const marker = new google.maps.Marker({
      position: { lat: r.lat, lng: r.lng },
      map: state.map,
      title: r.name,
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: "#f4c20d",
        fillOpacity: 1,
        strokeColor: "#a07d00",
        strokeWeight: 2,
        scale: 9,
      },
    });
    marker.addListener("click", () => {
      const html = `
        <div class="info-window">
          <h4>${iconEmoji(r.icon)} ${escapeHtml(r.name)}</h4>
          <div class="iw-addr">${escapeHtml(r.address || "")}</div>
          <div class="iw-tags">
            ${(r.tags || []).slice(0, 5).map(t => `<span class="tag-pill" style="background:${t.color || '#64803f'}">${escapeHtml(t.name)}</span>`).join("")}
          </div>
          <a href="${navLinkFor(r)}" target="_blank" rel="noopener">🧭 Navigazione</a>
        </div>`;
      state.infoWindow.setContent(html);
      state.infoWindow.open(state.map, marker);
    });
    state.markers.push(marker);
    bounds.extend({ lat: r.lat, lng: r.lng });
    count++;
  }
  if (count > 0 && !state.mapHasBeenFit) {
    state.map.fitBounds(bounds, 40);
    state.mapHasBeenFit = true;
  }
}

// --- Add view: search & confirm ------------------------------------
function performPlacesSearch() {
  const text = placesSearchInput.value.trim();
  if (!text) return;
  if (!state.autocompleteService) {
    toast("Mappa non ancora pronta, riprova fra un attimo.");
    return;
  }
  placesResultsEl.innerHTML = `<div style="padding:14px;color:#888;">Ricerca in corso…</div>`;
  state.autocompleteService.getPlacePredictions(
    { input: text, types: ["establishment"] },
    (preds, status) => {
      if (status !== google.maps.places.PlacesServiceStatus.OK || !preds) {
        placesResultsEl.innerHTML = `<div style="padding:14px;color:#888;">Nessun risultato.</div>`;
        return;
      }
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
$("#search-btn").addEventListener("click", performPlacesSearch);
placesSearchInput.addEventListener("keydown", e => { if (e.key === "Enter") performPlacesSearch(); });
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
