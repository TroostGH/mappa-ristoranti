// ============================================================
// CONFIGURAZIONE - Sostituisci i valori sotto con i tuoi
// ============================================================
//
// 1) Vai su https://console.firebase.google.com → crea un progetto
//    → Build → Firestore Database → Create (in production mode)
//    → Project Settings → Your apps → Web → registra app
//    → copia il blocco "firebaseConfig" e incollalo qui sotto.
//
// 2) Vai su https://console.cloud.google.com → APIs & Services
//    → Library → abilita "Maps JavaScript API" e "Places API (New)"
//    → Credentials → Create credentials → API key
//    → restringi la chiave per HTTP referrers (dominio github.io)
//    → incolla la chiave in GOOGLE_MAPS_API_KEY qui sotto.
//
// ATTENZIONE: queste chiavi sono visibili nel browser. La sicurezza
// si ottiene tramite le restrizioni della chiave e le Firestore Rules
// (non scrivendo "segreti" qui).
// ============================================================

export const firebaseConfig = {
  apiKey: "AIzaSyDaqlvLHcslLMljNpxAmP_qV66VTdiVZrM",
  authDomain: "mappa-ristoranti-9fbbb.firebaseapp.com",
  projectId: "mappa-ristoranti-9fbbb",
  storageBucket: "mappa-ristoranti-9fbbb.firebasestorage.app",
  messagingSenderId: "1070941645991",
  appId: "1:1070941645991:web:3f4a29883f312db7e27f82"
};

export const GOOGLE_MAPS_API_KEY = "AIzaSyDwalCYtECFEep_wCMhFzYReukfWd0FwP4";

// Centro iniziale della mappa (Italia)
export const MAP_DEFAULT_CENTER = { lat: 42.5, lng: 12.5 };
export const MAP_DEFAULT_ZOOM = 6;
